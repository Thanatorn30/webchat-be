import { Router, type Request, type Response } from "express";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  markConversationRead,
  deleteConversation,
} from "../controllers/conversations.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const conversationsRouter = Router();

// ทุกเส้นในไฟล์นี้: ต้อง login (owner / agent)
conversationsRouter.use(requireAuth);

const notImplemented = (what: string) => (_req: Request, res: Response) => {
  res.status(501).json({ error: "not implemented", todo: what });
};

/** GET /api/conversations?status=open&cursor=&limit=30 — รายการห้อง เรียงตาม last_message_at */
conversationsRouter.get("/", listConversations);

/** POST /api/conversations — { contactId, status?, assignedAdminId? } */
conversationsRouter.post("/", createConversation);

/** GET /api/conversations/:id */
conversationsRouter.get("/:id", getConversation);

/** PATCH /api/conversations/:id — { status?, assignedAdminId? } */
conversationsRouter.patch("/:id", updateConversation);

/** DELETE /api/conversations/:id — ลบห้อง + ข้อความทั้งหมด (owner เท่านั้น) */
conversationsRouter.delete("/:id", requireRole("owner"), deleteConversation);

/** POST /api/conversations/:id/read — unread_count = 0 */
conversationsRouter.post("/:id/read", markConversationRead);

/** GET /api/conversations/:id/messages?before=&limit=50 — ประวัติแชต (แบ่งหน้า) */
conversationsRouter.get("/:id/messages", notImplemented("list messages"));

/**
 * POST /api/conversations/:id/messages — แอดมินส่งข้อความ
 * 1. เช็ก contact.is_following (false → 409)
 * 2. INSERT messages (out, send_status='queued', retry_key = uuid ใหม่)
 * 3. pushMessage(lineUserId, messages, retryKey)  (src/lib/line.ts)
 * 4. UPDATE send_status / line_message_id + conversations.last_message_*
 * 5. realtime → message.updated
 */
conversationsRouter.post("/:id/messages", notImplemented("send message"));
