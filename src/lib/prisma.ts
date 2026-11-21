import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

function createClient() {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl() });
  // ซ่อน password ทุก query โดยอัตโนมัติ — ถ้าต้องใช้ (เช่น login) ให้ใส่ omit: { password: false }
  return new PrismaClient({ adapter, omit: { admin: { password: true } } });
}

let client: ReturnType<typeof createClient> | undefined;

/** สร้าง PrismaClient ตอนเรียกใช้ครั้งแรก (server ยังรันได้แม้ยังไม่ได้ตั้ง DB) */
export function prisma() {
  if (!client) client = createClient();
  return client;
}
