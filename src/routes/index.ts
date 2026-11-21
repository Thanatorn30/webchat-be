import { Router } from "express";
import { conversationsRouter } from "./conversations.js";
import { mediaRouter } from "./media.js";
import { adminsRouter } from "./admins.js";
import { authRouter } from "./auth.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/conversations", conversationsRouter); 
apiRouter.use("/media", mediaRouter); //                
apiRouter.use("/admins", adminsRouter); //     
