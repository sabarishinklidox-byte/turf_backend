import { Router } from "express";
import { getAdminUsers } from "../controllers/admin-user.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { listAdminUsersSchema } from "../schemas/admin-user.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/", validate(listAdminUsersSchema), getAdminUsers);

export default router;
