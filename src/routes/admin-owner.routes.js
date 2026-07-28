import { Router } from "express";
import { getOwnerVerificationDetails, getOwnerVerifications, updateOwnerVerification } from "../controllers/admin-owner.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { listOwnerVerificationsSchema, ownerVerificationIdSchema, reviewOwnerVerificationSchema } from "../schemas/admin-owner.schema.js";

const router = Router();
router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/", validate(listOwnerVerificationsSchema), getOwnerVerifications);
router.get("/:ownerId", validate(ownerVerificationIdSchema), getOwnerVerificationDetails);
router.patch("/:ownerId/review", validate(reviewOwnerVerificationSchema), updateOwnerVerification);
export default router;
