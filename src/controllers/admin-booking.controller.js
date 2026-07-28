import { listAdminBookings } from "../services/admin-booking.service.js";
import { cancelDirectBookingPayment, listDirectBookingPaymentLedger } from "../services/booking-payment.service.js";
import { cancelOpenMatchPayment, listOpenMatchPaymentLedger, markOpenMatchPayoutReleased } from "../services/open-match-payment.service.js";
import { emitTurfSlotsUpdated } from "../realtime/socket.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";

export const getAdminBookings = asyncHandler(async (request, response) => {
  const result = await listAdminBookings(request.query);
  sendSuccess(response, {
    data: result.items,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
      audit: result.audit,
    },
  });
});

export const getAdminOpenMatchPayments = asyncHandler(async (request, response) => {
  const result = await listOpenMatchPaymentLedger(request.query);
  sendSuccess(response, {
    data: result.matches,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});

export const getAdminDirectBookingPayments = asyncHandler(async (request, response) => {
  const result = await listDirectBookingPaymentLedger(request.query);
  sendSuccess(response, {
    data: result.bookings,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});

export const releaseAdminOpenMatchPayout = asyncHandler(async (request, response) => {
  const match = await markOpenMatchPayoutReleased({
    matchId: request.params.matchId,
    payoutReference: request.body.payoutReference,
  });
  sendSuccess(response, { message: "Host match payout marked as released", data: match });
});

export const cancelAdminOpenMatchPayment = asyncHandler(async (request, response) => {
  const match = await cancelOpenMatchPayment({
    matchId: request.params.matchId,
    reason: request.body.reason,
    actorRole: "ADMIN",
  });
  sendSuccess(response, { message: "Host match cancelled and refund flow started", data: match });
});

export const cancelAdminDirectBookingPayment = asyncHandler(async (request, response) => {
  const booking = await cancelDirectBookingPayment({
    bookingId: request.params.bookingId,
    reason: request.body.reason,
    actorRole: "ADMIN",
  });
  emitTurfSlotsUpdated(booking.turf?.id, "admin_booking_cancelled");
  auditLog({
    action: "admin.booking.cancelled",
    actorId: request.user.id,
    resourceType: "Booking",
    resourceId: booking.id,
    metadata: { reason: request.body.reason },
  });
  sendSuccess(response, {
    message: booking.paymentId ? "Direct booking cancelled and refund flow started" : "Direct booking cancelled",
    data: booking,
  });
});
