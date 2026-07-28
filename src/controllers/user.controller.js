import {
  bookSlot,
  cancelMyOpenMatch as cancelMyOpenMatchService,
  cancelUserBooking,
  createBookingPaymentOrder,
  createOpenMatchJoinPaymentOrder,
  createOpenMatchPaymentOrder,
  createOpenMatch as createOpenMatchService,
  createUserTeam as createUserTeamService,
  getPublicTurf,
  joinOpenMatch as joinOpenMatchService,
  listCommunityOpenMatches,
  listUserLeaders,
  listUserTeams,
  listMyOpenMatches,
  listOpenMatches,
  listPublicSlots,
  listPublicTurfs,
  listUserBookings,
  submitOpenMatchResult as submitOpenMatchResultService,
  getUserTeamMemberStatus as getUserTeamMemberStatusService,
  inviteUserTeamMember as inviteUserTeamMemberService,
  updateUserTeam as updateUserTeamService,
  verifyOpenMatchJoinPayment,
  verifyOpenMatchPaymentAndCreate,
  verifyBookingPaymentAndBookSlot,
} from "../services/user.service.js";
import { getVenueWeather } from "../services/weather.service.js";
import {
  checkTournamentPlayerEmailStatus,
  createTournamentEntryPaymentOrder,
  createTournament as createTournamentService,
  generateTournamentFixtures,
  getTournament as getTournamentService,
  joinTournamentTeam,
  listTournaments,
  recordTournamentMatchResult,
  sendTournamentPlayerInvite,
  updateTournamentMatchLiveScore,
  verifyTournamentEntryPaymentAndJoin,
} from "../services/tournament.service.js";
import { emitTournamentUpdated, emitTurfSlotsUpdated } from "../realtime/socket.js";
import {
  listNotifications,
  markNotificationRead,
  updateUserLocation as updateUserLocationService,
} from "../services/notification.service.js";
import { getActiveBookingPaymentGatewayConfig } from "../services/payment-gateway.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";
import { AppError } from "../utils/app-error.js";

export const getTurfs = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listPublicTurfs(request.query) });
});

export const getTurf = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await getPublicTurf(request.params.turfId) });
});

export const getTurfWeather = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await getVenueWeather(request.params.turfId) });
});

export const getSlots = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listPublicSlots(request.params.turfId, request.query) });
});

export const createBooking = asyncHandler(async (request, response) => {
  const gateway = await getActiveBookingPaymentGatewayConfig();
  if (gateway) {
    throw AppError.conflict("Booking payment is enabled. Start the payment checkout before booking.");
  }
  const booking = await bookSlot(request.user.id, request.body.slotId);
  emitTurfSlotsUpdated(booking.turf?.id, "slot_booked");
  auditLog({ action: "booking.created", actorId: request.user.id, resourceType: "Booking", resourceId: booking.id });
  sendSuccess(response, { statusCode: 201, message: "Slot booked successfully", data: booking });
});

export const createBookingOrder = asyncHandler(async (request, response) => {
  const data = await createBookingPaymentOrder(request.user.id, request.body.slotId);

  if (data.mode === "BOOKED") {
    emitTurfSlotsUpdated(data.booking.turf?.id, "slot_booked");
    auditLog({
      action: "booking.created",
      actorId: request.user.id,
      resourceType: "Booking",
      resourceId: data.booking.id,
    });
    sendSuccess(response, { statusCode: 201, message: "Slot booked successfully", data });
    return;
  }

  sendSuccess(response, { statusCode: 201, message: "Booking payment initiated", data });
});

export const verifyBookingPayment = asyncHandler(async (request, response) => {
  const booking = await verifyBookingPaymentAndBookSlot(request.user.id, request.body);
  emitTurfSlotsUpdated(booking.turf?.id, "slot_booked");
  auditLog({ action: "booking.created", actorId: request.user.id, resourceType: "Booking", resourceId: booking.id });
  sendSuccess(response, { statusCode: 201, message: "Slot booked successfully", data: booking });
});

export const getBookings = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listUserBookings(request.user.id) });
});

export const cancelBooking = asyncHandler(async (request, response) => {
  const booking = await cancelUserBooking(request.user.id, request.params.bookingId);
  emitTurfSlotsUpdated(booking.turf?.id, "slot_reopened");
  auditLog({ action: "booking.cancelled", actorId: request.user.id, resourceType: "Booking", resourceId: booking.id });
  sendSuccess(response, {
    message: booking.paymentId ? "Booking cancelled and refund flow started" : "Booking cancelled",
    data: booking,
  });
});

export const getOpenMatches = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listOpenMatches(request.query) });
});

export const getCommunityOpenMatches = asyncHandler(async (_request, response) => {
  sendSuccess(response, { data: await listCommunityOpenMatches() });
});

export const getLeaders = asyncHandler(async (_request, response) => {
  sendSuccess(response, { data: await listUserLeaders() });
});

export const getMyOpenMatches = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listMyOpenMatches(request.user.id) });
});

export const createOpenMatch = asyncHandler(async (request, response) => {
  const match = await createOpenMatchService(request.user.id, request.body);
  emitTurfSlotsUpdated(match.turf?.id, "open_match_created");
  auditLog({ action: "open_match.created", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { statusCode: 201, message: "Open match created", data: match });
});

export const createOpenMatchOrder = asyncHandler(async (request, response) => {
  const data = await createOpenMatchPaymentOrder(request.user.id, request.body);
  if (data.mode === "MATCH_CREATED") {
    emitTurfSlotsUpdated(data.match.turf?.id, "open_match_created");
    auditLog({ action: "open_match.created", actorId: request.user.id, resourceType: "OpenMatch", resourceId: data.match.id });
    sendSuccess(response, { statusCode: 201, message: "Open match created", data });
    return;
  }

  sendSuccess(response, { statusCode: 201, message: "Open match payment initiated", data });
});

export const verifyOpenMatchPayment = asyncHandler(async (request, response) => {
  const match = await verifyOpenMatchPaymentAndCreate(request.user.id, request.body);
  emitTurfSlotsUpdated(match.turf?.id, "open_match_created");
  auditLog({ action: "open_match.created", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { statusCode: 201, message: "Open match created", data: match });
});

export const getTeams = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listUserTeams(request.user.id) });
});

export const createUserTeam = asyncHandler(async (request, response) => {
  const logoUrl = request.file ? `/media/teams/${request.file.filename}` : undefined;
  const team = await createUserTeamService(request.user.id, { ...request.body, logoUrl });
  auditLog({ action: "team.created", actorId: request.user.id, resourceType: "UserTeam", resourceId: team.id });
  sendSuccess(response, { statusCode: 201, message: "Team created", data: team });
});

export const updateUserTeam = asyncHandler(async (request, response) => {
  const logoUrl = request.file ? `/media/teams/${request.file.filename}` : undefined;
  const team = await updateUserTeamService(request.user.id, request.params.teamId, { ...request.body, logoUrl });
  auditLog({ action: "team.updated", actorId: request.user.id, resourceType: "UserTeam", resourceId: team.id });
  sendSuccess(response, { message: "Team updated", data: team });
});

export const getUserTeamMemberStatus = asyncHandler(async (request, response) => {
  sendSuccess(response, {
    data: await getUserTeamMemberStatusService(request.user.id, request.query),
  });
});

export const inviteUserTeamMember = asyncHandler(async (request, response) => {
  sendSuccess(response, {
    statusCode: 201,
    message: "Invite sent",
    data: await inviteUserTeamMemberService(request.user.id, request.body),
  });
});

export const joinOpenMatch = asyncHandler(async (request, response) => {
  const match = await joinOpenMatchService(request.user.id, request.params.matchId, request.body);
  auditLog({ action: "open_match.joined", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { message: "Payment successful. You joined the match", data: match });
});

export const createOpenMatchJoinOrder = asyncHandler(async (request, response) => {
  const data = await createOpenMatchJoinPaymentOrder(request.user.id, request.params.matchId, request.body);
  if (data.mode === "JOINED") {
    auditLog({ action: "open_match.joined", actorId: request.user.id, resourceType: "OpenMatch", resourceId: data.match.id });
    sendSuccess(response, { statusCode: 201, message: "Payment successful. You joined the match", data });
    return;
  }

  sendSuccess(response, { statusCode: 201, message: "Open match join payment initiated", data });
});

export const verifyOpenMatchJoinPaymentHandler = asyncHandler(async (request, response) => {
  const match = await verifyOpenMatchJoinPayment(request.user.id, request.params.matchId, request.body);
  auditLog({ action: "open_match.joined", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { statusCode: 201, message: "Payment successful. You joined the match", data: match });
});

export const cancelMyOpenMatch = asyncHandler(async (request, response) => {
  const match = await cancelMyOpenMatchService(request.user.id, request.params.matchId);
  emitTurfSlotsUpdated(match.turf?.id, "open_match_updated");
  auditLog({ action: "open_match.cancelled_by_user", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  const isHost = match.host?.id === request.user.id;
  sendSuccess(response, {
    message: isHost ? "Hosted match cancelled" : "Host-match spot cancelled",
    data: match,
  });
});

export const submitOpenMatchResult = asyncHandler(async (request, response) => {
  const match = await submitOpenMatchResultService(request.user.id, request.params.matchId, request.body);
  auditLog({ action: "open_match.result_submitted", actorId: request.user.id, resourceType: "OpenMatch", resourceId: match.id });
  sendSuccess(response, { message: "Match result submitted", data: match });
});

export const getNotifications = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listNotifications(request.user.id) });
});

export const readNotification = asyncHandler(async (request, response) => {
  const notification = await markNotificationRead(request.user.id, request.params.notificationId);
  sendSuccess(response, { message: "Notification marked as read", data: notification });
});

export const updateUserLocation = asyncHandler(async (request, response) => {
  const location = await updateUserLocationService(request.user.id, request.body);
  sendSuccess(response, { message: "Location updated", data: location });
});

export const getTournaments = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listTournaments(request.query) });
});

export const getTournament = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await getTournamentService(request.params.tournamentId) });
});

export const createTournament = asyncHandler(async (request, response) => {
  const tournament = await createTournamentService(request.user.id, request.body);
  auditLog({ action: "tournament.created", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { statusCode: 201, message: "Tournament created", data: tournament });
});

export const joinTournament = asyncHandler(async (request, response) => {
  const team = await joinTournamentTeam(request.user.id, request.params.tournamentId, request.body);
  emitTournamentUpdated(request.params.tournamentId, "team_joined");
  auditLog({ action: "tournament.team_joined", actorId: request.user.id, resourceType: "TournamentTeam", resourceId: team.id });
  const message =
    team.status === "DRAFT"
      ? "Draft saved"
      : team.discountPercentApplied > 0
        ? `Team joined tournament. ${team.discountPercentApplied}% discount unlocked.`
        : "Team joined tournament";
  sendSuccess(response, { statusCode: 201, message, data: team });
});

export const createTournamentEntryOrder = asyncHandler(async (request, response) => {
  const data = await createTournamentEntryPaymentOrder(request.user.id, request.params.tournamentId, request.body);
  if (data.mode === "JOINED") {
    emitTournamentUpdated(request.params.tournamentId, "team_joined");
    auditLog({
      action: "tournament.team_joined",
      actorId: request.user.id,
      resourceType: "TournamentTeam",
      resourceId: data.team.id,
    });
    sendSuccess(response, { statusCode: 201, message: "Team joined tournament", data });
    return;
  }

  sendSuccess(response, { statusCode: 201, message: "Tournament entry payment initiated", data });
});

export const verifyTournamentEntryPayment = asyncHandler(async (request, response) => {
  const team = await verifyTournamentEntryPaymentAndJoin(request.user.id, request.params.tournamentId, request.body);
  emitTournamentUpdated(request.params.tournamentId, "team_joined");
  auditLog({
    action: "tournament.entry_payment_verified",
    actorId: request.user.id,
    resourceType: "TournamentTeam",
    resourceId: team.id,
  });
  sendSuccess(response, { statusCode: 201, message: "Payment successful. Team joined tournament", data: team });
});

export const getTournamentPlayerEmailStatus = asyncHandler(async (request, response) => {
  sendSuccess(response, {
    data: await checkTournamentPlayerEmailStatus(
      request.user.id,
      request.params.tournamentId,
      request.query.email,
    ),
  });
});

export const inviteTournamentPlayer = asyncHandler(async (request, response) => {
  sendSuccess(response, {
    statusCode: 201,
    message: "Invite sent",
    data: await sendTournamentPlayerInvite(request.user.id, request.params.tournamentId, request.body),
  });
});

export const createTournamentFixtures = asyncHandler(async (request, response) => {
  const tournament = await generateTournamentFixtures(request.user.id, request.params.tournamentId);
  emitTournamentUpdated(tournament.id, "fixtures_generated");
  auditLog({ action: "tournament.fixtures_generated", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { message: "Fixtures generated", data: tournament });
});

export const updateTournamentMatchResult = asyncHandler(async (request, response) => {
  const tournament = await recordTournamentMatchResult(request.user.id, request.params.tournamentId, request.params.matchId, request.body);
  emitTournamentUpdated(tournament.id, "match_result_saved");
  auditLog({ action: "tournament.match_result", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Match result saved", data: tournament });
});

export const updateTournamentMatchLiveScoreHandler = asyncHandler(async (request, response) => {
  const tournament = await updateTournamentMatchLiveScore(request.user.id, request.params.tournamentId, request.params.matchId, request.body);
  emitTournamentUpdated(tournament.id, "match_live_score_updated");
  auditLog({ action: "tournament.match_live_score", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Live score updated", data: tournament });
});
