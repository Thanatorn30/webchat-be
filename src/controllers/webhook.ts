import type { Request, Response } from "express";
import { Prisma, type MessageType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifySignature, getProfile } from "../lib/line.js";
import { messagePreview } from "../lib/messagePreview.js";
import { conversationInclude, messageInclude } from "../lib/includes.js";
import {
  emitContactUpdated,
  emitConversationUpdated,
  emitMessageCreated,
} from "../lib/realtime.js";
import type {
  LineEvent,
  LineMessageEvent,
  LineWebhookBody,
} from "../types/line.js";

// flow ทั้งหมดดู docs/LINE_WEBHOOK_FLOW.md

const MESSAGE_TYPES: readonly MessageType[] = ["text", "image", "video", "audio", "file", "sticker", "location"];

/** error จากการบันทึกข้อมูลซ้ำ (unique constraint) */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** userId ของคนที่คุยกับ OA ตรง ๆ (แชท 1:1) — ถ้ามาจากกลุ่ม/ห้อง คืน null */
function directUserId(event: LineEvent): string | null {
  if (event.source.type !== "user" || !event.source.userId) return null;
  return event.source.userId;
}

// ───────────────────────── contacts (async) ─────────────────────────

/** ดึงชื่อ/รูปจาก LINE แล้วอัปเดต contacts */
async function syncProfile(lineUserId: string): Promise<void> {
  try {
    const profile = await getProfile(lineUserId);
    const contact = await prisma().contact.update({
      where: { lineUserId },
      data: { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null },
    });
    emitContactUpdated(contact);
  } catch (err) {
    console.warn("[line webhook] syncProfile failed", lineUserId, err);
  }
}

// ───────────────────────── handlers ต่อชนิด event ─────────────────────────

/** ผลของ handler: lineUserId ที่ควรดึงโปรไฟล์หลังตอบ 200 */
type HandleResult = { syncProfileOf?: string };

/**
 * บันทึกข้อความขาเข้า: หา/สร้าง contact → หา/สร้าง conversation → สร้าง message → อัปเดตห้อง
 * ทำใน transaction เดียว — คืน null ถ้าข้อความนี้เคยบันทึกไปแล้ว
 */
async function saveIncomingMessage(event: LineMessageEvent, userId: string) {
  const type = event.message.type;
  const sentAt = new Date(event.timestamp);

  try {
    return await prisma().$transaction(async (tx) => {
      // LINE ส่ง event เดิมซ้ำ (redelivery) → ไม่บันทึกซ้ำ
      const existing = await tx.message.findUnique({
        where: { webhookEventId: event.webhookEventId },
        select: { id: true },
      });
      if (existing) return null;

      const contact = await tx.contact.upsert({
        where: { lineUserId: userId },
        create: { lineUserId: userId },
        update: {},
      });

      const conversation = await tx.conversation.upsert({
        where: { contactId: contact.id },
        create: { contactId: contact.id },
        update: {},
      });

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "in",
          type,
          text: type === "text" ? (event.message.text ?? null) : null,
          payload: event.message as Prisma.InputJsonValue,
          lineMessageId: event.message.id,
          webhookEventId: event.webhookEventId,
          createdAt: sentAt,
        },
        include: messageInclude,
      });

      const updatedConversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: sentAt,
          lastMessagePreview: messagePreview(type, event.message.text, event.message),
        },
        include: conversationInclude,
      });

      return { message, conversation: updatedConversation };
    });
  } catch (err) {
    // request ซ้อนกันบันทึกข้อความเดียวกันพร้อมกัน → อีกตัวทำไปแล้ว ถือว่าสำเร็จ
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/** เข็ค + create ข้อความที่ลูกค้าส่งมา + websocket */
async function handleMessage(event: LineMessageEvent): Promise<HandleResult> {
  const userId = directUserId(event);
  if (!userId) return {}; // ไม่รองรับกลุ่ม/ห้อง
  if (!MESSAGE_TYPES.includes(event.message.type)) return {}; // ชนิดที่ยังไม่รองรับ

  const saved = await saveIncomingMessage(event, userId);
  if (!saved) return {};

  // web socket
  emitMessageCreated(saved.conversation.id, saved.message);
  emitConversationUpdated(saved.conversation);


  // ยังไม่มีชื่อลูกค้า → ไปดึงโปรไฟล์
  return { syncProfileOf: saved.conversation.contact.displayName ? undefined : userId };
}

/** ประเภทการ follow (เอาไว้สร้าง flag เพื่อเช็คตอนส่งข้อความหา User) */
async function handleUnfollow(event: LineEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (!userId) return {};

  const contact = await prisma().contact.findUnique({ where: { lineUserId: userId } });
  if (!contact) return {}; // ไม่เคยรู้จักลูกค้าคนนี้ ไม่ต้องสร้าง

  const updated = await prisma().contact.update({
    where: { id: contact.id },
    data: { isFollowing: false },
  });
  // web socket
  emitContactUpdated(updated);
  return {};
}

/** แยกประเภทของ event */
async function handleEvent(event: LineEvent): Promise<HandleResult> {
  switch (event.type) {
    case "message":
      return handleMessage(event as LineMessageEvent);
    case "unfollow":
      return handleUnfollow(event);
    default:
      return {}; // follow / unsend / postback / join / ฯลฯ — ไม่ทำอะไร
  }
}

// ---- ใช้ try catch เพื่อให้ทำเสร็จทีละ event ------
async function processEvent(event: LineEvent): Promise<string | undefined> {
  try {
    return (await handleEvent(event)).syncProfileOf;
  } catch (err) {
    console.error("[line webhook] handle event failed", event.webhookEventId, err);
    return undefined;
  }
}

// ───────────────────────── route handler ─────────────────────────

/** ตรวจว่า request มาจาก LINE จริง (log รายละเอียดถ้าไม่ผ่าน) */
function hasValidSignature(req: Request): boolean {
  const rawBody = req.body as Buffer;
  const signature = req.header("x-line-signature");
  if (Buffer.isBuffer(rawBody) && verifySignature(rawBody, signature)) return true;

  console.warn("[line webhook] invalid signature", {
    hasSignature: Boolean(signature),
    isBuffer: Buffer.isBuffer(rawBody),
    bodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : null,
    contentType: req.header("content-type"),
  });
  return false;
}

// ------ Webhook ของ LINE ------------
export async function lineWebhook(req: Request, res: Response) {

  if (!hasValidSignature(req)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse((req.body as Buffer).toString("utf8")) as LineWebhookBody;
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  const profilesToSync = new Set<string>();
  for (const event of body.events ?? []) {
    const userId = await processEvent(event);
    if (userId) profilesToSync.add(userId);
  }
  res.sendStatus(200);

  // งานที่เรียก LINE API ทำหลังตอบ 200
  for (const userId of profilesToSync) void syncProfile(userId);
}
