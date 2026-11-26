import { Router } from "express";
import { listAdmins } from "../controllers/admins.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const adminsRouter = Router();

// ทุกเส้นในไฟล์นี้: ต้อง login + เป็น owner เท่านั้น
adminsRouter.use(requireAuth, requireRole("owner"));

adminsRouter.get("/", listAdmins);

