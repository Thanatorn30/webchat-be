import { Router } from "express";
import { conversationsRouter } from "./conversations.js";
import { mediaRouter } from "./media.js";
import { adminsRouter } from "./admins.js";
import { authRouter } from "./auth.js";
import { lineRouter } from "./line.js";
import { messagesRouter } from "./messages.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/conversations", conversationsRouter); 
apiRouter.use("/media", mediaRouter); //                
apiRouter.use("/admins", adminsRouter); //
apiRouter.use("/messages", messagesRouter); // GET / DELETE /api/messages/:messageId, POST .../retry
apiRouter.use("/line", lineRouter); // GET /api/line/events (webhook อยู่ที่ src/index.ts)
