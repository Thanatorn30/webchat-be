import type { Request, Response } from "express";
import { Prisma, ConversationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { conversationInclude } from "../lib/includes.js";
import { emitConversationUpdated } from "../lib/realtime.js";

const STATUSES = Object.values(ConversationStatus) as string[];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ข้อมูลที่แนบไปกับห้องแชตทุกครั้ง (ใช้ร่วมกับ realtime)
const include = conversationInclude;

type ConversationInput = {
  contactId?: string;
  status?: ConversationStatus;
  assignedAdminId?: string | null;
};

// validate ค่าจาก body — partial = true ตอน PATCH (ไม่ต้องส่งครบ)
function parseBody(
  body: Record<string, unknown>,
  partial: boolean,
): { data: ConversationInput } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }
  const { contactId, status, assignedAdminId } = body;
  const data: ConversationInput = {};

  // contactId ส่งได้ตอนสร้างเท่านั้น (1 contact = 1 ห้อง ย้ายไม่ได้)
  if (!partial) {
    if (typeof contactId !== "string" || !UUID_RE.test(contactId)) {
      return { error: "contactId is required and must be a uuid" };
    }
    data.contactId = contactId;
  } else if (contactId !== undefined) {
    return { error: "contactId cannot be changed" };
  }

  if (status !== undefined) {
    if (typeof status !== "string" || !STATUSES.includes(status)) {
      return { error: `status must be one of: ${STATUSES.join(", ")}` };
    }
    data.status = status as ConversationStatus;
  }

  // null = เอาคนรับผิดชอบออก
  if (assignedAdminId !== undefined) {
    if (
      assignedAdminId !== null &&
      (typeof assignedAdminId !== "string" || !UUID_RE.test(assignedAdminId))
    ) {
      return { error: "assignedAdminId must be a uuid or null" };
    }
    data.assignedAdminId = assignedAdminId;
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
      res.status(409).json({ error: "conversation for this contact already exists" });
      return;
    }
    if (err.code === "P2003") {
      // foreign key ไม่เจอ — contactId หรือ assignedAdminId ไม่มีอยู่จริง
      const field = String(err.meta?.field_name ?? err.meta?.constraint ?? "");
      const what = field.includes("admin") ? "assigned admin" : "contact";
      res.status(400).json({ error: `${what} not found` });
      return;
    }
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
 * GET /api/conversations?status=open&cursor=<id>&limit=30
 * เรียงตาม last_message_at ล่าสุดก่อน (ห้องที่ยังไม่มีข้อความอยู่ท้าย)
 * ตอบกลับ { items, nextCursor } — nextCursor = null แปลว่าหมดแล้ว
 */
export async function listConversations(req: Request, res: Response) {
  const { status, cursor, limit: limitRaw } = req.query;

  if (
    status !== undefined &&
    (typeof status !== "string" || !STATUSES.includes(status))
  ) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${STATUSES.join(", ")}` });
  }

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
      where: status ? { status: status as ConversationStatus } : undefined,
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

/** GET /api/conversations/:id */
export async function getConversation(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  try {
    const conversation = await prisma().conversation.findUnique({
      where: { id },
      include,
    });
    if (!conversation) return res.status(404).json({ error: "conversation not found" });
    res.json(conversation);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

export async function createConversation(req: Request, res: Response) {
  const parsed = parseBody(req.body, false);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });

  try {
    const conversation = await prisma().conversation.create({
      data: {
        contactId: parsed.data.contactId!,
        status: parsed.data.status,
        assignedAdminId: parsed.data.assignedAdminId,
      },
      include,
    });
    res.status(201).json(conversation);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/** PATCH /api/conversations/:id — { status?, assignedAdminId? } */
export async function updateConversation(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  const parsed = parseBody(req.body, true);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }

  try {
    const conversation = await prisma().conversation.update({
      where: { id },
      data: parsed.data,
      include,
    });
    emitConversationUpdated(conversation);
    res.json(conversation);
  } catch (err) {
    handlePrismaError(err, res);
  }
}

/** POST /api/conversations/:id/read — unread_count = 0 */
export async function markConversationRead(req: Request, res: Response) {
  const id = getId(req, res);
  if (!id) return;

  try {
    const conversation = await prisma().conversation.update({
      where: { id },
      data: { unreadCount: 0 },
      include,
    });
    emitConversationUpdated(conversation);
    res.json(conversation);
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
