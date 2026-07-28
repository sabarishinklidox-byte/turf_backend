import { Router } from "express";
import {
  getAdminBookingPaymentGateway,
  getAdminCancellationPolicy,
  getAdminTournamentRegistrationOffer,
  saveAdminBookingPaymentGateway,
  saveAdminCancellationPolicy,
  saveAdminTournamentRegistrationOffer,
} from "../controllers/admin-settings.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  bookingPaymentGatewaySettingsSchema,
  cancellationPolicySettingsSchema,
  tournamentRegistrationOfferSettingsSchema,
} from "../schemas/admin-settings.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/tournament-registration-offer", getAdminTournamentRegistrationOffer);
router.patch(
  "/tournament-registration-offer",
  validate(tournamentRegistrationOfferSettingsSchema),
  saveAdminTournamentRegistrationOffer,
);
router.get("/booking-payment-gateway", getAdminBookingPaymentGateway);
router.patch(
  "/booking-payment-gateway",
  validate(bookingPaymentGatewaySettingsSchema),
  saveAdminBookingPaymentGateway,
);
router.get("/cancellation-policy", getAdminCancellationPolicy);
router.patch(
  "/cancellation-policy",
  validate(cancellationPolicySettingsSchema),
  saveAdminCancellationPolicy,
);

export default router;
