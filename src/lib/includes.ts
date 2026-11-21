import type { Prisma } from "@prisma/client";

// รูปร่างข้อมูลที่ API และ realtime ใช้ร่วมกัน — FE ได้ข้อมูลหน้าตาเดียวกันทั้ง REST และ socket

const adminPublic = { select: { id: true, name: true, email: true, role: true } } as const;

export const conversationInclude = {
  contact: true,
  assignedAdmin: adminPublic,
} satisfies Prisma.ConversationInclude;

export const messageInclude = {
  senderAdmin: adminPublic,
} satisfies Prisma.MessageInclude;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;
export type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
