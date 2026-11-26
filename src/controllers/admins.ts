import type { Request, Response } from "express";
import { AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const ROLES = Object.values(AdminRole) as string[];

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
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
}
