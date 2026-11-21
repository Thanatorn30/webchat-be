# webchat-be

Backend ของระบบ LINE OA ↔ Web chat (Express + TypeScript + Prisma 7 + PostgreSQL)

สถานะ: **ขึ้นโครงอย่างเดียว** — schema พร้อม แต่ **ยังไม่ได้รัน migrate** และ route ส่วนใหญ่ยังตอบ 501

## โครงสร้าง

```
prisma/schema.prisma        ตาราง admins, contacts, conversations, messages, webhook_events
prisma.config.ts            ชี้ไปที่ schema + DATABASE_URL
src/index.ts                Express app (webhook ต้องมาก่อน express.json)
src/config/env.ts           อ่าน .env
src/lib/prisma.ts           PrismaClient (adapter-pg)
src/lib/line.ts             verifySignature, getProfile, getMessageContent, pushMessage (X-Line-Retry-Key)
src/routes/webhook.ts       POST /api/line/webhook  — ตรวจ signature แล้ว ส่วนบันทึก DB ยังเป็น TODO
src/routes/conversations.ts รายการห้อง / ประวัติ / ส่งข้อความ / read / PATCH — 501
src/routes/media.ts         GET /api/media/:messageId — 501
src/types/line.ts           type ของ webhook event
```

## เริ่มใช้งาน

```bash
cp .env.example .env      # ใส่ DATABASE_URL, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN
npm install
npm run db:generate       # สร้าง Prisma Client
npm run dev               # http://localhost:4000/health
```

## Migrate (ยังไม่ได้รัน)

เมื่อสร้างฐานข้อมูลแล้ว:

```bash
npm run migrate -- --name init   # prisma migrate dev → สร้าง prisma/migrations/ และตาราง
```

ฝั่ง production ใช้ `npm run migrate:deploy`

## API

| Method | Path | สถานะ |
|---|---|---|
| GET | /health | ✅ |
| POST | /api/line/webhook | ✅ ตรวจ signature / ⏳ บันทึก DB |
| GET | /api/conversations | ⏳ |
| GET | /api/conversations/:id/messages | ⏳ |
| POST | /api/conversations/:id/messages | ⏳ |
| POST | /api/conversations/:id/read | ⏳ |
| PATCH | /api/conversations/:id | ⏳ |
| GET | /api/media/:messageId | ⏳ |

Flow แบบละเอียดอยู่ในไฟล์ draw.io "test-webchat" หน้า Schema และ API Flow
