// ชนิดข้อมูล webhook ของ LINE เท่าที่ระบบใช้

export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

export interface LineEventBase {
  type: string;
  webhookEventId: string;
  deliveryContext: { isRedelivery: boolean };
  timestamp: number;
  source: { type: "user" | "group" | "room"; userId?: string };
  replyToken?: string;
}

export interface LineMessageEvent extends LineEventBase {
  type: "message";
  message: {
    id: string;
    type: "text" | "image" | "video" | "audio" | "file" | "sticker" | "location";
    text?: string;
    [key: string]: unknown;
  };
}

export type LineEvent = LineMessageEvent | LineEventBase;
