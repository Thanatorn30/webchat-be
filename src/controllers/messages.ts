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
  emitMessageDeleted,
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

/** อัปเดตสรุปห้องจากข้อความล่าสุดที่เหลืออยู่ (ใช้หลังส่ง/ลบ) */
async function refreshConversationSummary(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  const last = await tx.message.findFirst({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { type: true, text: true, payload: true, createdAt: true },
  });
  return tx.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: last?.createdAt ?? null,
      lastMessagePreview: last ? messagePreview(last.type, last.text, last.payload) : null,
    },
    include: conversationInclude,
  });
}

/** push ข้อความ out ไป LINE แล้วอัปเดต send_status (ใช้ทั้งตอนส่งครั้งแรกและส่งซ้ำ) */
async function deliver(messageId: string, lineUserId: string, text: string, retryKey: string) {
  const result = await pushMessage(lineUserId, [{ type: "text", text }], retryKey);
  const message = await prisma().message.update({
    where: { id: messageId },
    data: result.ok
      ? {
          sendStatus: "sent",
          sendError: null,
          lineMessageId: result.sentMessageIds[0] ?? undefined,
        }
      : { sendStatus: "failed", sendError: `${result.status}: ${result.error}`.slice(0, 2000) },
    include,
  });
  emitMessageUpdated(message.conversationId, message);
  return message;
}

// ───────────────────────── Read ─────────────────────────

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


export async function getMessage(req: Request, res: Response) {
  const id = getUuid(req, res, "messageId");
  if (!id) return;

  try {
    const message = await prisma().message.findUnique({ where: { id }, include });
    if (!message) return res.status(404).json({ error: "message not found" });
    res.json(message);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

// ───────────────────────── Create ─────────────────────────

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
    if (!conversation) return res.status(404).json({ error: "conversation not found" });
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

    // แจ้งแอดมินทุกคนว่ามีข้อความ (queued) — ผลการส่งตามมาเป็น message.updated (ใน deliver)
    emitMessageCreated(conversationId, created);
    emitConversationUpdated(updatedConversation);

    const message = await deliver(created.id, conversation.contact.lineUserId, text, retryKey);
    res.status(201).json(message);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

// ───────────────────────── Update ─────────────────────────

export async function retryMessage(req: Request, res: Response) {
  const id = getUuid(req, res, "messageId");
  if (!id) return;

  try {
    const message = await prisma().message.findUnique({
      where: { id },
      include: { conversation: { include: { contact: true } } },
    });
    if (!message) return res.status(404).json({ error: "message not found" });
    if (message.direction !== "out" || message.sendStatus !== "failed") {
      return res.status(409).json({ error: "only failed outgoing messages can be retried" });
    }
    if (!message.conversation.contact.isFollowing) {
      return res.status(409).json({ error: "contact has blocked the official account" });
    }

    const retryKey = message.retryKey ?? crypto.randomUUID();
    const queued = await prisma().message.update({
      where: { id },
      data: { sendStatus: "queued", sendError: null, retryKey },
      include,
    });
    emitMessageUpdated(queued.conversationId, queued);

    const updated = await deliver(
      id,
      message.conversation.contact.lineUserId,
      message.text ?? "",
      retryKey,
    );
    res.json(updated);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

// ───────────────────────── Delete ─────────────────────────

export async function deleteMessage(req: Request, res: Response) {
  const id = getUuid(req, res, "messageId");
  if (!id) return;

  try {
    const conversation = await prisma().$transaction(async (tx) => {
      const message = await tx.message.delete({
        where: { id },
        select: { conversationId: true },
      });
      return refreshConversationSummary(tx, message.conversationId);
    });
    emitMessageDeleted(conversation.id, id);
    emitConversationUpdated(conversation);
    res.status(204).end();
  } catch (err) {
    handlePrismaError(err, res);
  }
}
