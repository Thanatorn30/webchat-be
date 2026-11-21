import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getRecentEvents } from "../lib/recentEvents.js";

export const lineRouter = Router();

lineRouter.get("/events", requireAuth, (_req, res) => {
  res.json({ items: getRecentEvents() });
});
