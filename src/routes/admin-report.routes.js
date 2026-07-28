import { Router } from "express";
import { getAdminReportsOverview } from "../controllers/admin-report.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getAdminReportsSchema } from "../schemas/admin-report.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/", validate(getAdminReportsSchema), getAdminReportsOverview);

export default router;
