import {
  getTournamentRegistrationOffer,
  updateTournamentRegistrationOffer,
} from "../services/tournament-offer.service.js";
import {
  getCancellationPolicyForAdmin,
  updateCancellationPolicy,
} from "../services/cancellation-policy.service.js";
import {
  getBookingPaymentGatewayForAdmin,
  updateBookingPaymentGateway,
} from "../services/payment-gateway.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";

export const getAdminTournamentRegistrationOffer = asyncHandler(async (_request, response) => {
  sendSuccess(response, { data: await getTournamentRegistrationOffer() });
});

export const saveAdminTournamentRegistrationOffer = asyncHandler(async (request, response) => {
  const data = await updateTournamentRegistrationOffer(request.body);
  auditLog({
    action: "admin.settings.tournament_registration_offer_updated",
    actorId: request.user.id,
    resourceType: "TournamentRegistrationOfferSetting",
    resourceId: "tournament-registration-offer",
  });
  sendSuccess(response, { message: "Tournament offer updated", data });
});

export const getAdminBookingPaymentGateway = asyncHandler(async (_request, response) => {
  sendSuccess(response, { data: await getBookingPaymentGatewayForAdmin() });
});

export const saveAdminBookingPaymentGateway = asyncHandler(async (request, response) => {
  const data = await updateBookingPaymentGateway(request.body);
  auditLog({
    action: "admin.settings.booking_payment_gateway_updated",
    actorId: request.user.id,
    resourceType: "BookingPaymentGatewaySetting",
    resourceId: "booking-payment-gateway",
  });
  sendSuccess(response, { message: "Booking payment gateway updated", data });
});

export const getAdminCancellationPolicy = asyncHandler(async (_request, response) => {
  sendSuccess(response, { data: await getCancellationPolicyForAdmin() });
});

export const saveAdminCancellationPolicy = asyncHandler(async (request, response) => {
  const data = await updateCancellationPolicy(request.body);
  auditLog({
    action: "admin.settings.cancellation_policy_updated",
    actorId: request.user.id,
    resourceType: "CancellationPolicySetting",
    resourceId: "cancellation-policy-master",
  });
  sendSuccess(response, { message: "Cancellation policy updated", data });
});
