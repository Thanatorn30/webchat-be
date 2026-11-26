import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { conversationInclude } from "../lib/includes.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ข้อมูลที่แนบไปกับห้องแชตทุกครั้ง (ใช้ร่วมกับ realtime)
const include = conversationInclude;

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
    if (err.code === "P2025") {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: "internal error" });
}

// ---------------------------------------

/**
 * GET /api/conversations?cursor=<id>&limit=30
 * เรียงตาม last_message_at ล่าสุดก่อน (ห้องที่ยังไม่มีข้อความอยู่ท้าย)
 * ตอบกลับ { items, nextCursor } — nextCursor = null แปลว่าหมดแล้ว
 */
export async function listConversations(req: Request, res: Response) {
  const { cursor, limit: limitRaw } = req.query;

  if (cursor !== undefined && (typeof cursor !== "string" || !UUID_RE.test(cursor))) {
    return res.status(400).json({ error: "cursor must be a uuid" });
  }

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be 1-${MAX_LIMIT}` });
    }
  }

  try {
    const rows = await prisma().conversation.findMany({
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      cursor: cursor ? { id: cursor as string } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1, // ดึงเกิน 1 แถวเพื่อดูว่ามีหน้าถัดไปไหม
      include,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/**
 * DELETE /api/conversations/:id
 * ลบห้อง + ข้อความทั้งหมดในห้อง (onDelete: Cascade) — contact ยังอยู่
 */
export async function deleteConversation(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  try {
    await prisma().conversation.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    handlePrismaError(err, res);
  }
}
