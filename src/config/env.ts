import "dotenv/config";

function required(name: string): string {
  // trim — กันช่องว่าง/ขึ้นบรรทัดใหม่ที่ติดมาตอน copy ใส่ Render (ทำให้ signature ไม่ตรง)
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  databaseUrl: () => required("DATABASE_URL"),
  jwt: {
    secret: () => required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  },
  line: {
    channelSecret: () => required("LINE_CHANNEL_SECRET"),
    channelAccessToken: () => required("LINE_CHANNEL_ACCESS_TOKEN"),
  },
};
