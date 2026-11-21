import { Router } from "express";
import { getMessage, retryMessage, deleteMessage } from "../controllers/messages.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// เส้นที่อ้างข้อความด้วย id ตรงๆ — list / ส่ง อยู่ใต้ /api/conversations/:id/messages
export const messagesRouter = Router();

messagesRouter.use(requireAuth);

/** GET /api/messages/:messageId */
messagesRouter.get("/:messageId", getMessage);

/** DELETE /api/messages/:messageId — ลบออกจาก DB (owner เท่านั้น) */
messagesRouter.delete("/:messageId", requireRole("owner"), deleteMessage);
