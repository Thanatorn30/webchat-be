/** ข้อความสั้นๆ แสดงในรายการห้อง (conversations.last_message_preview) — ไม่เกิน 255 ตัวอักษร */
export function messagePreview(type: string, text: string | null | undefined, payload?: unknown): string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");

  let out: string;
  switch (type) {
    case "text":
      out = text ?? "";
      break;
    case "image":
      out = "[รูปภาพ]";
      break;
    case "video":
      out = "[วิดีโอ]";
      break;
    case "audio":
      out = "[ข้อความเสียง]";
      break;
    case "file":
      out = `[ไฟล์] ${str("fileName")}`.trim();
      break;
    case "sticker":
      out = "[สติกเกอร์]";
      break;
    case "location":
      out = `[ตำแหน่ง] ${str("title") || str("address")}`.trim();
      break;
    default:
      out = `[${type}]`;
  }
  return out.slice(0, 255);
}
