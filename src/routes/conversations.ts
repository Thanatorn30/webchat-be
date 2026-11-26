import { Router } from "express";
import {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
} from "../controllers/conversations.js";
import { listMessages, sendMessage } from "../controllers/messages.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const conversationsRouter = Router();

// ทุกเส้นในไฟล์นี้: ต้อง login (owner / agent)
conversationsRouter.use(requireAuth);

/** GET /api/conversations?cursor=&limit=30 — รายการห้อง เรียงตาม last_message_at */
conversationsRouter.get("/", listConversations);

/** POST /api/conversations — { contactId } */
conversationsRouter.post("/", createConversation);

/** GET /api/conversations/:id */
conversationsRouter.get("/:id", getConversation);

/** DELETE /api/conversations/:id — ลบห้อง + ข้อความทั้งหมด (owner เท่านั้น) */
conversationsRouter.delete("/:id", requireRole("owner"), deleteConversation);

/** GET /api/conversations/:id/messages?before=&limit=50 — ประวัติแชต (แบ่งหน้า, เก่า → ใหม่) */
conversationsRouter.get("/:id/messages", listMessages);

/** POST /api/conversations/:id/messages — { text } แอดมินส่งข้อความหาลูกค้าผ่าน LINE */
conversationsRouter.post("/:id/messages", sendMessage);
