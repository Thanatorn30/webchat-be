import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { webhookRouter } from "./routes/webhook.js";
import { apiRouter } from "./routes/index.js";
import { initRealtime } from "./lib/realtime.js";

const app = express();

// webhook ต้องมาก่อน express.json() เพราะต้องใช้ raw body ตรวจ signature
app.use("/api/line/webhook", webhookRouter);

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", apiRouter); // route ทั้งหมดอยู่ใน src/routes/index.ts

// Socket.IO เกาะ http server ตัวเดียวกับ express (port เดียวกัน, path /socket.io)
const server = createServer(app);
initRealtime(server);

server.listen(env.port, () => {
  console.log(`webchat-be listening on http://localhost:${env.port}`);
});
