import express, { Router } from "express";
import { lineWebhook } from "../controllers/webhook.js";

export const webhookRouter = Router();

/**
 * POST /api/line/webhook
 * ใช้ express.raw เพื่อเก็บ raw body ไว้ตรวจ signature (ห้าม parse JSON ก่อน)
 * บันทึกลง webhook_events / contacts / conversations / messages — ดู src/controllers/webhook.ts
 */
webhookRouter.post("/", express.raw({ type: "*/*" }), lineWebhook);
