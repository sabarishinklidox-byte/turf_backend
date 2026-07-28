import { Router } from "express";
import {
  checkTurfOwnerAvailability,
  editApprovedTurf,
  getApprovedTurfs,
  getTurf,
  getTurfs,
  updateTurfActivation,
} from "../controllers/turf.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  checkOwnerAvailabilitySchema,
  listApprovedTurfsSchema,
  listTurfsSchema,
  turfIdSchema,
  updateTurfActivationSchema,
  updateTurfSchema,
} from "../schemas/turf.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get(
  "/owner-availability",
  validate(checkOwnerAvailabilitySchema),
  checkTurfOwnerAvailability,
);
router.get("/", validate(listTurfsSchema), getTurfs);
router.get("/approved", validate(listApprovedTurfsSchema), getApprovedTurfs);
router.get("/:turfId", validate(turfIdSchema), getTurf);
router.patch("/:turfId", validate(updateTurfSchema), editApprovedTurf);
router.patch("/:turfId/activation", validate(updateTurfActivationSchema), updateTurfActivation);

export default router;
