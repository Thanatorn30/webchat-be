import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import type { Contact, Message } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import type { ConversationWithRelations } from "./includes.js";

// realtime (Socket.IO) — BE → FE ทางเดียว, FE ยังส่งข้อความผ่าน REST
// รายละเอียด/รายการ event ดู docs/REALTIME_WEBSOCKET.md

const ADMINS_ROOM = "admins"; // แอดมินทุกคนเห็นทุกห้อง

type SocketAdmin = { id: string; name: string; role: string };

let io: Server | undefined;

export function initRealtime(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  // ตรวจ JWT ตอน connect — logic เดียวกับ requireAuth (เช็ก DB ด้วย: แอดมินถูกลบ → ต่อไม่ได้)
  io.use(async (socket, next) => {
    try {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token) return next(new Error("missing token"));

      const payload = jwt.verify(token, env.jwt.secret());
      if (typeof payload !== "object" || typeof payload.sub !== "string") {
        return next(new Error("invalid token"));
      }

      const admin = await prisma().admin.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, role: true },
      });
      if (!admin) return next(new Error("admin no longer exists"));

      socket.data.admin = admin satisfies SocketAdmin;
      next();
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      next(new Error(expired ? "token expired" : "invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const admin = socket.data.admin as SocketAdmin;
    socket.join(ADMINS_ROOM);
    console.log("[realtime] connected", admin.id);
    socket.on("disconnect", (reason) => console.log("[realtime] disconnected", admin.id, reason));
  });
}

// ───── ฟังก์ชันที่ controller เรียก — ยังไม่ init (เช่น ตอนทดสอบ) = ไม่ทำอะไร ─────
// เรียกหลัง transaction commit แล้วเท่านั้น

export function emitMessageCreated(conversationId: string, message: Message): void {
  io?.to(ADMINS_ROOM).emit("message.created", { conversationId, message });
}

export function emitMessageUpdated(conversationId: string, message: Message): void {
  io?.to(ADMINS_ROOM).emit("message.updated", { conversationId, message });
}

export function emitConversationUpdated(conversation: ConversationWithRelations): void {
  io?.to(ADMINS_ROOM).emit("conversation.updated", { conversation });
}

export function emitContactUpdated(contact: Contact): void {
  io?.to(ADMINS_ROOM).emit("contact.updated", { contact });
}
