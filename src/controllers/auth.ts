import type { Request, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { Prisma, AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, passwordError } from "../lib/password.js";
import { env } from "../config/env.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AdminPublic = { id: string; email: string; name: string; role: AdminRole };

/** สร้าง JWT — ใส่แค่ข้อมูลที่จำเป็น (ห้ามใส่ password) */
function signToken(admin: AdminPublic): string {
  return jwt.sign({ sub: admin.id, role: admin.role }, env.jwt.secret(), {
    expiresIn: env.jwt.expiresIn as SignOptions["expiresIn"],
  });
}

/** ดึง string ออกจาก body — ไม่ใช่ string = undefined */
function str(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** โยนออกจาก transaction เมื่อมีแอดมินในระบบแล้ว */
class RegisterClosedError extends Error {}

/**
 * POST /api/auth/register — { email, name, password }
 * - สมัครได้แค่คนเดียว (ตอนยังไม่มีแอดมินในระบบ) และได้ role = owner
 * - มีแอดมินแล้ว → 403
 */
export async function register(req: Request, res: Response) {
  const email = str(req.body, "email")?.trim().toLowerCase();
  const name = str(req.body, "name")?.trim();
  const password = str(req.body, "password");

  if (!email || !EMAIL_RE.test(email) || email.length > 255) {
    return res.status(400).json({ error: "email is required and must be a valid email (max 255)" });
  }
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "name is required (1-100 chars)" });
  }
  const pwError = passwordError(password);
  if (pwError || !password) {
    return res.status(400).json({ error: pwError });
  }

  try {
    const hashed = await hashPassword(password);

    // นับ + สร้างใน transaction เดียว (Serializable) กันกรณีมีคนกด register พร้อมกัน 2 คน
    const admin = await prisma().$transaction(
      async (tx) => {
        if ((await tx.admin.count()) > 0) throw new RegisterClosedError();
        return tx.admin.create({
          data: { email, name, password: hashed, role: AdminRole.owner },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    res.status(201).json({ token: signToken(admin), admin });
  } catch (err) {
    // P2034 = transaction ชนกัน (อีกคน register สำเร็จไปก่อน)
    const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
    if (err instanceof RegisterClosedError || raced) {
      return res.status(403).json({ error: "registration is closed" });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
}

/** POST /api/auth/login — { email, password } */
export async function login(req: Request, res: Response) {
  const email = str(req.body, "email")?.trim().toLowerCase();
  const password = str(req.body, "password");

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const found = await prisma().admin.findUnique({
      where: { email },
      omit: { password: false }, // ต้องใช้ password มาเทียบ
    });

    // ตอบข้อความเดียวกันทั้ง "ไม่มี email" และ "รหัสผิด" — ไม่ให้เดาได้ว่า email ไหนมีในระบบ
    if (!found || !(await verifyPassword(password, found.password))) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const { password: _hash, ...admin } = found; // ตัด password ออกก่อนส่งกลับ
    res.json({ token: signToken(admin), admin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
}
