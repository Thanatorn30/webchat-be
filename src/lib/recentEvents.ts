import type { LineEvent } from "../types/line.js";

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
