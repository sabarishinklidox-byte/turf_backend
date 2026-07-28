import { Router } from "express";
import { cancelAdminDirectBookingPayment, cancelAdminOpenMatchPayment, getAdminBookings, getAdminDirectBookingPayments, getAdminOpenMatchPayments, releaseAdminOpenMatchPayout } from "../controllers/admin-booking.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { cancelDirectBookingPaymentSchema, cancelOpenMatchPaymentSchema, listAdminBookingsSchema, listDirectBookingPaymentsSchema, listOpenMatchPaymentsSchema, releaseOpenMatchPayoutSchema } from "../schemas/admin-booking.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/booking-payments", validate(listDirectBookingPaymentsSchema), getAdminDirectBookingPayments);
router.patch("/booking-payments/:bookingId/cancel", validate(cancelDirectBookingPaymentSchema), cancelAdminDirectBookingPayment);
router.get("/open-match-payments", validate(listOpenMatchPaymentsSchema), getAdminOpenMatchPayments);
router.patch("/open-match-payments/:matchId/release", validate(releaseOpenMatchPayoutSchema), releaseAdminOpenMatchPayout);
router.patch("/open-match-payments/:matchId/cancel", validate(cancelOpenMatchPaymentSchema), cancelAdminOpenMatchPayment);
router.get("/", validate(listAdminBookingsSchema), getAdminBookings);

export default router;
