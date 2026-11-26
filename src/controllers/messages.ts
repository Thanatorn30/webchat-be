import crypto from "node:crypto";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { pushMessage } from "../lib/line.js";
import { messagePreview } from "../lib/messagePreview.js";
import { conversationInclude, messageInclude } from "../lib/includes.js";
import {
  emitConversationUpdated,
  emitMessageCreated,
  emitMessageUpdated,
} from "../lib/realtime.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_TEXT = 5000; // LINE จำกัดข้อความ text ไว้ 5000 ตัวอักษร

// ข้อมูลที่แนบไปกับข้อความทุกครั้ง (ใช้ร่วมกับ realtime)
const include = messageInclude;

// เช็ค uuid จาก req.params[name]
function getUuid(req: Request, res: Response, name: string): string | undefined {
  const id = String(req.params[name]);
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: `invalid ${name}` });
    return undefined;
  }
  return id;
}

function handlePrismaError(err: unknown, res: Response): void {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    res.status(404).json({ error: "message not found" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal error" });
}






// ---- ดึงรายการ message -------
export async function listMessages(req: Request, res: Response) {
  const conversationId = getUuid(req, res, "id");
  if (!conversationId) return;

  const { before, limit: limitRaw } = req.query;
  if (before !== undefined && (typeof before !== "string" || !UUID_RE.test(before))) {
    return res.status(400).json({ error: "before must be a uuid" });
  }

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be 1-${MAX_LIMIT}` });
    }
  }

  try {
    const conversation = await prisma().conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) return res.status(404).json({ error: "conversation not found" });

    if (before) {
      const cursorMsg = await prisma().message.findFirst({
        where: { id: before, conversationId },
        select: { id: true },
      });
      if (!cursorMsg) return res.status(400).json({ error: "before message not in this conversation" });
    }

    // ดึงใหม่ → เก่า แล้วกลับลำดับตอนตอบ
    const rows = await prisma().message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      cursor: before ? { id: before } : undefined,
      skip: before ? 1 : 0,
      take: limit + 1, // เกิน 1 แถวเพื่อดูว่ายังมีเก่ากว่านี้ไหม
      include,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      items: page.reverse(),
      nextBefore: hasMore ? page[0].id : null, 
    });
  } catch (err) {
    handlePrismaError(err, res);
  }
}

// ───────────────────────── Create ─────────────────────────

/** push ข้อความ out ไป LINE แล้วอัปเดต send_status */
async function deliver(messageId: string, lineUserId: string, text: string, retryKey: string) {
  const result = await pushMessage(lineUserId, [{ type: "text", text }], retryKey);
  // update flag สถานะการส่ง
  let data: Prisma.MessageUpdateInput;
  if (result.ok) {
    data = {
      sendStatus: "sent",
      sendError: null,
      lineMessageId: result.sentMessageIds[0] ?? undefined,
    };
  } else {
    data = {
      sendStatus: "failed",
      sendError: `${result.status}: ${result.error}`.slice(0, 2000),
    };
  }

  const message = await prisma().message.update({
    where: { id: messageId },
    data,
    include,
  });
  // web socket
  emitMessageUpdated(message.conversationId, message);
  return message;
}

export async function sendMessage(req: Request, res: Response) {
  const conversationId = getUuid(req, res, "id");
  if (!conversationId) return;

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_TEXT) {
    return res.status(400).json({ error: `text must be at most ${MAX_TEXT} characters` });
  }

  try {
    const conversation = await prisma().conversation.findUnique({
      where: { id: conversationId },
      include: { contact: { select: { lineUserId: true, isFollowing: true } } },
    });
    // เช็คว่ามีห้องไหม
    if (!conversation) return res.status(404).json({ error: "conversation not found" });
    // เช็คว่าถูก blog ไหม
    if (!conversation.contact.isFollowing) {
      return res.status(409).json({ error: "contact has blocked the official account" });
    }

    const retryKey = crypto.randomUUID();
    const { created, updatedConversation } = await prisma().$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          direction: "out",
          senderAdminId: req.admin!.id,
          type: "text",
          text,
          retryKey,
          sendStatus: "queued",
        },
        include,
      });
      const updatedConversation = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: message.createdAt,
          lastMessagePreview: messagePreview("text", text),
        },
        include: conversationInclude,
      });
      return { created: message, updatedConversation };
    });

    // websoket
    emitMessageCreated(conversationId, created);
    emitConversationUpdated(updatedConversation);

    const message = await deliver(created.id, conversation.contact.lineUserId, text, retryKey);
    res.status(201).json(message);
  } catch (err) {
    handlePrismaError(err, res);
  }
}
