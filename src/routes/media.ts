import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const mediaRouter = Router();

mediaRouter.use(requireAuth);

/** GET /api/media/:messageId — คืน signed URL ของไฟล์ใน storage (ไม่เปิด storage เป็น public) */
mediaRouter.get("/:messageId", (_req, res) => {
  res.status(501).json({ error: "not implemented", todo: "signed media url" });
});
