import type { Request, Response } from "express";
import { Prisma, type MessageType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifySignature, getProfile } from "../lib/line.js";
import { pushRecentEvent } from "../lib/recentEvents.js";
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

/** ข้อความสั้นๆ แสดงในรายการห้อง (ไม่เกิน 255 ตัวอักษร) */
function preview(message: LineMessageEvent["message"]): string {
  const str = (key: string) => {
    const v = message[key];
    return typeof v === "string" ? v : "";
  };
  let text: string;
  switch (message.type) {
    case "text":
      text = message.text ?? "";
      break;
    case "image":
      text = "[รูปภาพ]";
      break;
    case "video":
      text = "[วิดีโอ]";
      break;
    case "audio":
      text = "[ข้อความเสียง]";
      break;
    case "file":
      text = `[ไฟล์] ${str("fileName")}`.trim();
      break;
    case "sticker":
      text = "[สติกเกอร์]";
      break;
    case "location":
      text = `[ตำแหน่ง] ${str("title") || str("address")}`.trim();
      break;
    default:
      text = `[${String(message.type)}]`;
  }
  return text.slice(0, 255);
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
    await prisma().contact.update({
      where: { lineUserId },
      data: { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null },
    });
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

  const contact = await prisma().$transaction(async (tx) => {
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

    try {
      await tx.message.create({
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
      });
    } catch (err) {
      // webhook_event_id ซ้ำ = ข้อความนี้บันทึกไปแล้ว → ถือว่าสำเร็จ
      if (isUniqueViolation(err)) return contact;
      throw err;
    }

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: sentAt,
        lastMessagePreview: preview(event.message),
        unreadCount: { increment: 1 },
        status: "open", // ห้องที่ปิด/รออยู่ถูกเปิดกลับเมื่อลูกค้าทักมา
      },
    });

    return contact;
  });

  // TODO: ไฟล์แนบ (media_status = pending) → getMessageContent แล้วเก็บลง storage
  // TODO: แจ้ง realtime → message.created
  return { syncProfileOf: contact.displayName ? undefined : userId };
}

async function handleFollow(event: LineEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (event.source.type !== "user" || !userId) return {};
  const at = new Date(event.timestamp);

  await prisma().contact.upsert({
    where: { lineUserId: userId },
    create: { lineUserId: userId, isFollowing: true, followedAt: at },
    update: { isFollowing: true, followedAt: at, unfollowedAt: null },
  });
  return { syncProfileOf: userId };
}

async function handleUnfollow(event: LineEvent): Promise<HandleResult> {
  const userId = event.source.userId;
  if (!userId) return {};
  await prisma().contact.updateMany({
    where: { lineUserId: userId },
    data: { isFollowing: false, unfollowedAt: new Date(event.timestamp) },
  });
  return {};
}

async function handleUnsend(event: LineUnsendEvent): Promise<HandleResult> {
  await prisma().message.updateMany({
    where: { lineMessageId: event.unsend.messageId, direction: "in" },
    data: { isUnsent: true },
  });
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
  if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, req.header("x-line-signature"))) {
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
