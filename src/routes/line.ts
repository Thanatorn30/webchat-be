import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getRecentEvents } from "../lib/recentEvents.js";

export const lineRouter = Router();

/**
 * GET /api/line/events — event ล่าสุดที่ webhook ได้รับ (เก็บในหน่วยความจำ ไม่ลง DB)
 * ตอบ { items: [{ receivedAt, event }] } ใหม่สุดก่อน
 */
lineRouter.get("/events", requireAuth, (_req, res) => {
  res.json({ items: getRecentEvents() });
});
