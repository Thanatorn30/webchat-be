import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // ใช้กับ Prisma CLI (migrate) เท่านั้น — แอปตอนรันใช้ DATABASE_URL ผ่าน adapter (src/lib/prisma.ts)
  // Neon pooler (-pooler) ไม่รองรับ advisory lock ของ migrate → ใช้ DIRECT_URL (host ไม่มี -pooler) ถ้ามี
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
