import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import filesRouter from "./files";
import usersRouter from "./users";
import shareRouter from "./share";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(filesRouter);
router.use(usersRouter);
router.use(shareRouter);

export default router;
