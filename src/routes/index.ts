import { Router } from "express";
import { conversationsRouter } from "./conversations.js";
import { authRouter } from "./auth.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/conversations", conversationsRouter); 
