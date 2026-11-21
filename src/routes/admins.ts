import { Router } from "express";
import {
  listAdmins,
  getAdmin,
  updateAdmin,
  deleteAdmin,
} from "../controllers/admins.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const adminsRouter = Router();

// ทุกเส้นในไฟล์นี้: ต้อง login + เป็น owner เท่านั้น
adminsRouter.use(requireAuth, requireRole("owner"));

adminsRouter.get("/", listAdmins);
adminsRouter.get("/:id", getAdmin);
adminsRouter.patch("/:id", updateAdmin);
adminsRouter.delete("/:id", deleteAdmin);
