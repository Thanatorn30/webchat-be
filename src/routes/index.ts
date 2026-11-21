import { Router } from "express";
import { conversationsRouter } from "./conversations.js";
import { adminsRouter } from "./admins.js";
import { authRouter } from "./auth.js";
import { lineRouter } from "./line.js";
import { messagesRouter } from "./messages.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/conversations", conversationsRouter); 
apiRouter.use("/admins", adminsRouter); 
apiRouter.use("/messages", messagesRouter); 
apiRouter.use("/line", lineRouter); 
