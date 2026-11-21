import express, { Router } from "express";
import { verifySignature } from "../lib/line.js";
import type { LineWebhookBody } from "../types/line.js";

export const webhookRouter = Router();

/**
 * POST /api/line/webhook
 * ใช้ express.raw เพื่อเก็บ raw body ไว้ตรวจ signature (ห้าม parse JSON ก่อน)
 */
webhookRouter.post("/", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = req.body as Buffer;
  if (!verifySignature(rawBody, req.header("x-line-signature"))) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  const body = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;

  for (const event of body.events) {
    // TODO 1: INSERT webhook_events ON CONFLICT DO NOTHING → ถ้าชน (เคยได้แล้ว) ให้ข้าม
    // TODO 2: แยกตาม event.type
    //   message  → upsert contacts + conversations, INSERT messages (direction='in')
    //              UPDATE conversations (last_message_*, unread_count + 1, status='open')
    //              ถ้าเป็น image/video/audio/file → media_status='pending' + เข้าคิวดาวน์โหลด
    //   follow   → is_following = true (+ ดึงโปรไฟล์)
    //   unfollow → is_following = false
    //   unsend   → UPDATE messages SET is_unsent = true WHERE line_message_id = ...
    // TODO 3: แจ้ง realtime → message.created
    void event;
  }

  // ตอบ 200 ให้เร็ว งานหนัก (โปรไฟล์ / ไฟล์) ทำแบบ async
  res.sendStatus(200);
});
