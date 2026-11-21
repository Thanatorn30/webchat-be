import type { Request, Response } from "express";
import { Prisma, type MessageType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifySignature, getProfile } from "../lib/line.js";
import { pushRecentEvent } from "../lib/recentEvents.js";
import { messagePreview } from "../lib/messagePreview.js";
import { conversationInclude, messageInclude } from "../lib/includes.js";
import {
  emitContactUpdated,
  emitConversationUpdated,
  emitMessageCreated,
  emitMessageUpdated,
} from "../lib/realtime.js";
import type {
  LineEvent,
  LineMessageEvent,
  LineUnsendEvent,
  LineWebhookBody,
} from "../types/line.js";

// flow ทั้งหมดดู docs/LINE_WEBHOOK_FLOW.md

const MESSAGE_TYPES: readonly MessageType[] = [
  "text",
  "image",
  "video",
  "audio",
  "file",
  "sticker",
  "location",
];
const MEDIA_TYPES: readonly MessageType[] = ["image", "video", "audio", "file"];

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ───────────────────────── webhook_events ─────────────────────────

/**
 * บันทึก event ลง webhook_events (ถ้ายังไม่มี)
 * คืน false = เคยประมวลผลสำเร็จแล้ว → ข้าม
 */
async function recordEvent(event: LineEvent): Promise<boolean> {
  const db = prisma();
  const existing = await db.webhookEvent.findUnique({
    where: { webhookEventId: event.webhookEventId },
    select: { processedAt: true },
  });
  if (existing?.processedAt) return false;
  if (existing) return true; // รอบก่อนพัง → ทำใหม่

  try {
    await db.webhookEvent.create({
      data: {
        webhookEventId: event.webhookEventId,
        eventType: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
        isRedelivery: event.deliveryContext?.isRedelivery ?? false,
      },
    });
    return true;
  } catch (err) {
    // request ซ้อนกันส่ง event เดียวกันมาพร้อมกัน → อีกตัวทำไปแล้ว
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function markProcessed(webhookEventId: string): Promise<void> {
  await prisma().webhookEvent.update({
    where: { webhookEventId },
    data: { processedAt: new Date(), error: null },
  });
}

async function markFailed(webhookEventId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma()
    .webhookEvent.update({
      where: { webhookEventId },
      data: { error: message.slice(0, 2000) },
    })
    .catch((e) => console.error("[line webhook] mark failed error", e));
}

// ───────────────────────── contacts (async) ─────────────────────────

/** ดึงชื่อ/รูปจาก LINE แล้วอัปเดต contacts — เรียกหลังตอบ 200 แล้ว, พังได้ไม่เป็นไร */
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

async function handleMessage(event: LineMessageEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (event.source.type !== "user" || !userId) return {}; // ไม่รองรับกลุ่ม/ห้อง

  const type = event.message.type;
  if (!MESSAGE_TYPES.includes(type)) return {}; // ชนิดที่ยังไม่รองรับ — มี log ใน webhook_events แล้ว

  const sentAt = new Date(event.timestamp);

  let result;
  try {
    result = await prisma().$transaction(async (tx) => {
      // ข้อความนี้บันทึกไปแล้ว (รอบก่อนบันทึกได้แต่ mark processed ไม่ทัน) → ไม่ทำซ้ำ
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
          mediaStatus: MEDIA_TYPES.includes(type) ? "pending" : null,
          createdAt: sentAt,
        },
        include: messageInclude,
      });

      const updatedConversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: sentAt,
          lastMessagePreview: messagePreview(type, event.message.text, event.message),
          unreadCount: { increment: 1 },
          status: "open", // ห้องที่ปิด/รออยู่ถูกเปิดกลับเมื่อลูกค้าทักมา
        },
        include: conversationInclude,
      });

      return { message, conversation: updatedConversation };
    });
  } catch (err) {
    // request ซ้อนกันบันทึกข้อความเดียวกันพร้อมกัน → อีกตัวทำไปแล้ว ถือว่าสำเร็จ
    if (isUniqueViolation(err)) return {};
    throw err;
  }
  if (!result) return {};

  // หลัง commit แล้วเท่านั้น → แจ้งหน้าแอดมิน
  emitMessageCreated(result.conversation.id, result.message);
  emitConversationUpdated(result.conversation);

  // TODO: ไฟล์แนบ (media_status = pending) → getMessageContent แล้วเก็บลง storage
  return { syncProfileOf: result.conversation.contact.displayName ? undefined : userId };
}

async function handleFollow(event: LineEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (event.source.type !== "user" || !userId) return {};
  const at = new Date(event.timestamp);

  const contact = await prisma().contact.upsert({
    where: { lineUserId: userId },
    create: { lineUserId: userId, isFollowing: true, followedAt: at },
    update: { isFollowing: true, followedAt: at, unfollowedAt: null },
  });
  emitContactUpdated(contact);
  return { syncProfileOf: userId };
}

async function handleUnfollow(event: LineEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (!userId) return {};
  const contact = await prisma().contact.findUnique({ where: { lineUserId: userId } });
  if (!contact) return {}; // ไม่เคยรู้จักลูกค้าคนนี้ ไม่ต้องสร้าง

  const updated = await prisma().contact.update({
    where: { id: contact.id },
    data: { isFollowing: false, unfollowedAt: new Date(event.timestamp) },
  });
  emitContactUpdated(updated);
  return {};
}

async function handleUnsend(event: LineUnsendEvent): Promise<HandleResult> {
  const targets = await prisma().message.findMany({
    where: { lineMessageId: event.unsend.messageId, direction: "in" },
    select: { id: true },
  });
  for (const { id } of targets) {
    const message = await prisma().message.update({
      where: { id },
      data: { isUnsent: true },
      include: messageInclude,
    });
    emitMessageUpdated(message.conversationId, message);
  }
  return {};
}

async function handleEvent(event: LineEvent): Promise<HandleResult> {
  switch (event.type) {
    case "message":
      return handleMessage(event as LineMessageEvent);
    case "follow":
      return handleFollow(event);
    case "unfollow":
      return handleUnfollow(event);
    case "unsend":
      return handleUnsend(event as LineUnsendEvent);
    default:
      return {}; // postback / join / ฯลฯ — เก็บแค่ใน webhook_events
  }
}

// ───────────────────────── route handler ─────────────────────────

/**
 * POST /api/line/webhook
 * req.body ต้องเป็น Buffer (express.raw) เพื่อตรวจ signature
 */
export async function lineWebhook(req: Request, res: Response) {
  const rawBody = req.body as Buffer;
  const signature = req.header("x-line-signature");
  if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, signature)) {
    console.warn("[line webhook] invalid signature", {
      hasSignature: Boolean(signature),
      isBuffer: Buffer.isBuffer(rawBody),
      bodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : null,
      contentType: req.header("content-type"),
    });
    return res.status(401).json({ error: "invalid signature" });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  const profilesToSync = new Set<string>();

  // ทีละ event — event หนึ่งพังไม่ทำให้ event อื่นพังตาม
  for (const event of body.events ?? []) {
    pushRecentEvent(event); // ให้ GET /api/line/events ดูได้
    console.log("[line webhook]", event.type, event.webhookEventId);

    try {
      if (!(await recordEvent(event))) continue; // เคยทำแล้ว
    } catch (err) {
      console.error("[line webhook] record event failed", err);
      continue;
    }

    try {
      const result = await handleEvent(event);
      if (result.syncProfileOf) profilesToSync.add(result.syncProfileOf);
      await markProcessed(event.webhookEventId);
    } catch (err) {
      console.error("[line webhook] handle event failed", event.webhookEventId, err);
      await markFailed(event.webhookEventId, err);
    }
  }

  res.sendStatus(200);

  // งานที่เรียก LINE API ทำหลังตอบ 200
  for (const userId of profilesToSync) void syncProfile(userId);
}
