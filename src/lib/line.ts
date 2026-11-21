import crypto from "node:crypto";
import { env } from "../config/env.js";

const API = "https://api.line.me";
const API_DATA = "https://api-data.line.me";

/** ตรวจ x-line-signature จาก raw body (ต้องเป็น body ก่อน parse JSON) */
export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", env.line.channelSecret())
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.line.channelAccessToken()}` };
}

/** GET /v2/bot/profile/{userId} */
export async function getProfile(userId: string) {
  const res = await fetch(`${API}/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`getProfile ${res.status}`);
  return (await res.json()) as { userId: string; displayName: string; pictureUrl?: string };
}

/** GET api-data.line.me/v2/bot/message/{messageId}/content — ไฟล์รูป/วิดีโอ/เสียง/ไฟล์ */
export async function getMessageContent(messageId: string) {
  const res = await fetch(`${API_DATA}/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`getMessageContent ${res.status}`);
  return {
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    body: Buffer.from(await res.arrayBuffer()),
  };
}

export type PushResult =
  | { ok: true; sentMessageIds: string[] }
  | { ok: false; status: number; retryable: boolean; error: string };

/**
 * POST /v2/bot/message/push
 */
export async function pushMessage(to: string, messages: unknown[], retryKey: string): Promise<PushResult> {
  const res = await fetch(`${API}/v2/bot/message/push`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "X-Line-Retry-Key": retryKey },
    body: JSON.stringify({ to, messages }),
  });
  if (res.ok) {
    const data = (await res.json()) as { sentMessages?: { id: string }[] };
    return { ok: true, sentMessageIds: data.sentMessages?.map((m) => m.id) ?? [] };
  }
  if (res.status === 409) return { ok: true, sentMessageIds: [] };
  return {
    ok: false,
    status: res.status,
    retryable: res.status === 429 || res.status >= 500,
    error: await res.text(),
  };
}
