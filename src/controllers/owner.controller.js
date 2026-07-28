import {
  createOwnerSlotSchedule,
  createOwnerVenue,
  listOwnerBlockedSlots,
  getOwnerProfile,
  listOwnerBookings,
  listOwnerUnbookedSlots,
  listOwnerSlots,
  listOwnerTurfs,
  updateOwnerPayoutDetails,
  updateOwnerSlot,
  updateOwnerSlots,
} from "../services/owner.service.js";
import { cancelDirectBookingPayment, listDirectBookingPaymentLedger } from "../services/booking-payment.service.js";
import {
  getGeoNamesStatus,
  listGeoNamesCitiesByState,
  listGeoNamesStates,
  resolveAddressFromCoordinates,
  searchAddressSuggestions,
} from "../services/location.service.js";
import {
  cancelTournament,
  createTournamentManualMatch,
  createOwnerTournament,
  generateTournamentFixtures,
  generateTournamentPlayoffs,
  listTournamentEntryPayments,
  listOwnerTournaments,
  recordTournamentMatchResult,
  updateTournamentMatchLiveScore,
} from "../services/tournament.service.js";
import { unlink } from "node:fs/promises";
import { emitTournamentUpdated, emitTurfSlotsUpdated } from "../realtime/socket.js";
import { confirmOpenMatchOfflineCollection, listOpenMatchPaymentLedger } from "../services/open-match-payment.service.js";
import { cancelOpenMatchPayment } from "../services/open-match-payment.service.js";
import { AppError } from "../utils/app-error.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";

export const getOwnerTurfs = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerTurfs(request.user.id) });
});

export const getProfile = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await getOwnerProfile(request.user.id) });
});

export const saveOwnerPayoutDetails = asyncHandler(async (request, response) => {
  sendSuccess(response, {
    message: "Payout details updated",
    data: await updateOwnerPayoutDetails(request.user.id, request.body),
  });
});

export const resolveOwnerLocation = asyncHandler(async (request, response) => {
  const data = await resolveAddressFromCoordinates(request.query);
  if (!data) throw AppError.validation("Unable to resolve location from the selected coordinates");
  sendSuccess(response, { data });
});

export const searchOwnerLocations = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await searchAddressSuggestions({ query: request.query.q }) });
});

export const getOwnerLocationStates = asyncHandler(async (_request, response) => {
  const status = await getGeoNamesStatus();
  if (!status.ok) throw AppError.validation(status.message ?? "GeoNames is not ready");
  sendSuccess(response, { data: await listGeoNamesStates() });
});

export const getOwnerLocationCities = asyncHandler(async (request, response) => {
  const status = await getGeoNamesStatus();
  if (!status.ok) throw AppError.validation(status.message ?? "GeoNames is not ready");
  sendSuccess(response, { data: await listGeoNamesCitiesByState(request.query) });
});

export const registerOwnerVenue = asyncHandler(async (request, response) => {
  const files = request.files ?? [];
  if (files.length === 0) throw AppError.validation("Upload at least one venue image");
  try {
    const imageUrls = files.map((file) => `/media/venues/${file.filename}`);
    const turf = await createOwnerVenue(request.user.id, request.body, imageUrls);
    sendSuccess(response, { statusCode: 201, message: "Venue created successfully", data: turf });
  } catch (error) {
    await Promise.allSettled(files.map((file) => unlink(file.path)));
    throw error;
  }
});

export const createSlotSchedule = asyncHandler(async (request, response) => {
  const result = await createOwnerSlotSchedule(request.user.id, request.params.turfId, request.body);
  emitTurfSlotsUpdated(request.params.turfId, "slots_generated");
  auditLog({ action: "turf.slots.generated", actorId: request.user.id, resourceType: "Turf", resourceId: request.params.turfId, metadata: result });
  sendSuccess(response, { statusCode: 201, message: `${result.created} slots created`, data: result });
});

export const getOwnerSlots = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerSlots(request.user.id, request.params.turfId, request.query) });
});

export const getOwnerBookings = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerBookings(request.user.id) });
});

export const getOwnerOpenMatchPayments = asyncHandler(async (request, response) => {
  const result = await listOpenMatchPaymentLedger({ ...request.query, ownerUserId: request.user.id });
  sendSuccess(response, {
    data: result.matches,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});

export const getOwnerBookingPayments = asyncHandler(async (request, response) => {
  const result = await listDirectBookingPaymentLedger({ ...request.query, ownerUserId: request.user.id });
  sendSuccess(response, {
    data: result.bookings,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});

export const saveOwnerOpenMatchOfflineCollection = asyncHandler(async (request, response) => {
  const match = await confirmOpenMatchOfflineCollection({
    ownerUserId: request.user.id,
    matchId: request.params.matchId,
    ...request.body,
  });
  auditLog({ action: "owner.open_match.offline_collection", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { message: "Offline turf balance captured", data: match });
});

export const cancelOwnerOpenMatch = asyncHandler(async (request, response) => {
  const match = await cancelOpenMatchPayment({
    ownerUserId: request.user.id,
    matchId: request.params.matchId,
    reason: request.body.reason,
    actorRole: "TURF_OWNER",
  });
  emitTurfSlotsUpdated(match.turf?.id, "owner_open_match_cancelled");
  auditLog({
    action: "owner.open_match.cancelled",
    actorId: request.user.id,
    resourceType: "OpenMatch",
    resourceId: match.id,
    metadata: { reason: request.body.reason },
  });
  sendSuccess(response, { message: "Host match cancelled and refund flow started", data: match });
});

export const getOwnerUnbookedSlots = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerUnbookedSlots(request.user.id) });
});

export const getOwnerBlockedSlots = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerBlockedSlots(request.user.id) });
});

export const cancelBookedUserSlot = asyncHandler(async (request, response) => {
  const booking = await cancelDirectBookingPayment({
    bookingId: request.params.bookingId,
    ownerUserId: request.user.id,
    reason: request.body.reason,
    actorRole: "TURF_OWNER",
  });
  emitTurfSlotsUpdated(booking.turf?.id, "owner_booking_cancelled");
  auditLog({
    action: "owner.booking.cancelled",
    actorId: request.user.id,
    resourceType: "Booking",
    resourceId: booking.id,
    metadata: { reason: request.body.reason },
  });
  sendSuccess(response, {
    message: booking.paymentId ? "Booked slot cancelled and refund flow started" : "Booked slot cancelled",
    data: booking,
  });
});

export const changeOwnerSlot = asyncHandler(async (request, response) => {
  const slot = await updateOwnerSlot(request.user.id, request.params.turfId, request.params.slotId, request.body.status);
  emitTurfSlotsUpdated(request.params.turfId, slot.status === "BLOCKED" ? "slot_blocked" : "slot_available");
  sendSuccess(response, { message: `Slot marked as ${slot.status.toLowerCase()}`, data: slot });
});

export const bulkChangeOwnerSlots = asyncHandler(async (request, response) => {
  const slots = await updateOwnerSlots(request.user.id, request.params.turfId, request.body.slotIds, request.body.status);
  emitTurfSlotsUpdated(request.params.turfId, request.body.status === "BLOCKED" ? "slots_blocked" : "slots_available");
  sendSuccess(response, { message: `${slots.length} slots updated`, data: slots });
});

export const getOwnerTournaments = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOwnerTournaments(request.user.id, request.query) });
});

export const getOwnerTournamentPayments = asyncHandler(async (request, response) => {
  const result = await listTournamentEntryPayments({ ...request.query, ownerUserId: request.user.id });
  sendSuccess(response, { data: result.payments, meta: { pagination: result.pagination, metrics: result.metrics } });
});

export const cancelOwnerTournament = asyncHandler(async (request, response) => {
  const tournament = await cancelTournament(request.user.id, request.params.tournamentId, {
    reason: request.body.reason,
    actorRole: "TURF_OWNER",
    requireHost: true,
  });
  emitTournamentUpdated(tournament.id, "tournament_cancelled");
  auditLog({
    action: "owner.tournament.cancelled",
    actorId: request.user.id,
    resourceType: "Tournament",
    resourceId: tournament.id,
    metadata: { reason: request.body.reason },
  });
  sendSuccess(response, { message: "Tournament cancelled and team refund flow started", data: tournament });
});

export const registerOwnerTournament = asyncHandler(async (request, response) => {
  try {
    const coverImageUrl = request.file ? `/media/tournaments/${request.file.filename}` : undefined;
    const tournament = await createOwnerTournament(request.user.id, { ...request.body, coverImageUrl });
    auditLog({ action: "owner.tournament.created", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
    sendSuccess(response, { statusCode: 201, message: "Tournament created", data: tournament });
  } catch (error) {
    if (request.file) await unlink(request.file.path).catch(() => {});
    throw error;
  }
});

export const createOwnerTournamentFixtures = asyncHandler(async (request, response) => {
  const tournament = await generateTournamentFixtures(request.user.id, request.params.tournamentId);
  emitTournamentUpdated(tournament.id, "fixtures_generated");
  auditLog({ action: "owner.tournament.fixtures_generated", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { message: "Fixtures generated", data: tournament });
});

export const createOwnerTournamentPlayoffs = asyncHandler(async (request, response) => {
  const tournament = await generateTournamentPlayoffs(request.user.id, request.params.tournamentId);
  emitTournamentUpdated(tournament.id, "playoffs_generated");
  auditLog({ action: "owner.tournament.playoffs_generated", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { message: "Playoffs generated", data: tournament });
});

export const createOwnerTournamentManualMatch = asyncHandler(async (request, response) => {
  const tournament = await createTournamentManualMatch(request.user.id, request.params.tournamentId, request.body);
  emitTournamentUpdated(tournament.id, "manual_match_created");
  auditLog({ action: "owner.tournament.match_created", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { statusCode: 201, message: "Match created", data: tournament });
});

export const updateOwnerTournamentMatchResult = asyncHandler(async (request, response) => {
  const tournament = await recordTournamentMatchResult(request.user.id, request.params.tournamentId, request.params.matchId, request.body);
  emitTournamentUpdated(tournament.id, "match_result_saved");
  auditLog({ action: "owner.tournament.match_result", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Match result saved", data: tournament });
});

export const updateOwnerTournamentMatchLiveScore = asyncHandler(async (request, response) => {
  const tournament = await updateTournamentMatchLiveScore(request.user.id, request.params.tournamentId, request.params.matchId, request.body);
  emitTournamentUpdated(tournament.id, "match_live_score_updated");
  auditLog({ action: "owner.tournament.match_live_score", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Live score updated", data: tournament });
});
