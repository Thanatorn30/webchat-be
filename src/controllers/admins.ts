import type { Request, Response } from "express";
import { Prisma, AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, passwordError } from "../lib/password.js";

const ROLES = Object.values(AdminRole) as string[];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminInput = { email?: string; name?: string; password?: string; role?: AdminRole };

// เขียน validate ค่าจาก body
function parseBody(
  body:  Record<string, unknown>,
  partial: boolean,
): { data: AdminInput } | { error: string } {
  if (typeof body !== "object" || body === null){
    return { error: "body must be a JSON object" };
  }
  const { email, name, password, role } = body;
  const data: AdminInput = {};

  if (email !== undefined || !partial) {
    if (
      typeof email !== "string" ||
      !EMAIL_RE.test(email.trim()) ||
      email.trim().length > 255
    ) {
      return { error: "email is required and must be a valid email (max 255)" };
    }
    data.email = email.trim().toLowerCase();
  }

  if (name !== undefined || !partial) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return { error: "name is required (1-100 chars)" };
    }
    data.name = name.trim();
  }

  // เก็บรหัสจริงไว้ก่อน — hash ตอนบันทึก (ใน updateAdmin)
  if (password !== undefined || !partial) {
    const pwError = passwordError(password);
    if (pwError) return { error: pwError };
    data.password = password as string;
  }

  if (role !== undefined) {
    if (typeof role !== "string" || !ROLES.includes(role)) {
      return { error: `role must be one of: ${ROLES.join(", ")}` };
    }
    data.role = role as AdminRole;
  }

  return { data };
}

// เช็ค Id
function getId(req: Request, res: Response): string | undefined {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid id" });
    return undefined;
  }
  return id;
}

function handlePrismaError(err: unknown, res: Response): void {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "email already exists" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "admin not found" });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: "internal error" });
}


// ---------------------------------------

// ไม่มี createAdmin — สร้างแอดมินได้ทางเดียวคือ POST /api/auth/register (ได้แค่คนแรก)

/** GET /api/admins?role=agent */
export async function listAdmins(req: Request, res: Response) {
  const role = req.query.role;
  if (
    role !== undefined &&
    (typeof role !== "string" || !ROLES.includes(role))
  ) {
    return res
      .status(400)
      .json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }

  try {
    const admins = await prisma().admin.findMany({
      where: role ? { role: role as AdminRole } : undefined,
      orderBy: { createdAt: "asc" },
    });
    res.json(admins);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/** GET by id /api/admins/:id */
export async function getAdmin(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  try {
    const admin = await prisma().admin.findUnique({ where: { id } });
    if (!admin) return res.status(404).json({ error: "admin not found" });
    res.json(admin);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/** PATCH /api/admins/:id — { email?, name?, password?, role? } */
export async function updateAdmin(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  const parsed = parseBody(req.body, true);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }

  try {
    const admin = await prisma().admin.update({
      where: { id },
      data: {
        ...parsed.data,
        password: parsed.data.password ? await hashPassword(parsed.data.password) : undefined,
      },
    });
    res.json(admin);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/**
 * DELETE /api/admins/:id
 * ข้อความที่แอดมินคนนี้ส่งยังอยู่ — sender_admin_id จะเป็น NULL
 */
export async function deleteAdmin(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  try {
    await prisma().admin.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    handlePrismaError(err, res);
  }
}
