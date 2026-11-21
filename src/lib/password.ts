import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** ตรวจรหัสผ่าน — ผ่าน = undefined, ไม่ผ่าน = ข้อความ error */
export function passwordError(password: unknown): string | undefined {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `password must be ${PASSWORD_MIN}-${PASSWORD_MAX} chars`;
  }
  return undefined;
}

/** แปลงรหัสผ่านเป็น hash — ผลลัพธ์รูปแบบ "salt:hash" (hex) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** เทียบรหัสผ่านกับ hash ที่เก็บไว้ */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
