import type { LineEvent } from "../types/line.js";

/**
 * เก็บ event ล่าสุดจาก webhook ไว้ในหน่วยความจำ (ไม่ลง DB)
 * - เก็บแค่ MAX_EVENTS ตัวล่าสุด
 * - server restart / Render sleep → หายหมด
 */
const MAX_EVENTS = 100;

export interface RecentEvent {
  receivedAt: string;
  event: LineEvent;
}

const events: RecentEvent[] = [];

export function pushRecentEvent(event: LineEvent): void {
  events.unshift({ receivedAt: new Date().toISOString(), event });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

/** ใหม่สุดก่อน */
export function getRecentEvents(): RecentEvent[] {
  return events;
}
