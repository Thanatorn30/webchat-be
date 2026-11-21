import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

export type AuthAdmin = { id: string; email: string; name: string; role: AdminRole };

// เพิ่มช่อง req.admin ให้ TypeScript รู้จัก
declare global {
  namespace Express {
    interface Request {
      admin?: AuthAdmin;
    }
  }
}

/** ดึง token จาก header "Authorization: Bearer <token>" */
function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

/**
 * ต้อง login ก่อน — ผ่านแล้วจะมี req.admin ให้ใช้ใน controller
 * เช็กกับ DB ทุกครั้ง: แอดมินถูกลบ → token ใช้ไม่ได้ทันที, เปลี่ยน role → มีผลทันที
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "missing token" });

  let adminId: string;
  try {
    const payload = jwt.verify(token, env.jwt.secret());
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      return res.status(401).json({ error: "invalid token" });
    }
    adminId = payload.sub;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    return res.status(401).json({ error: expired ? "token expired" : "invalid token" });
  }

  try {
    const admin = await prisma().admin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!admin) return res.status(401).json({ error: "admin no longer exists" });

    req.admin = admin;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
}

/** จำกัด role — ใช้ต่อจาก requireAuth เช่น requireRole("owner") */
export function requireRole(...roles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) return res.status(401).json({ error: "unauthorized" });
    if (!roles.includes(req.admin.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
