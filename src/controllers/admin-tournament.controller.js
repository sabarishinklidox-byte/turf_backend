import { unlink } from "node:fs/promises";
import { emitTournamentUpdated } from "../realtime/socket.js";
import {
  cancelTournament,
  createTournamentManualMatch,
  createTournament,
  generateTournamentFixtures,
  generateTournamentPlayoffs,
  listTournamentEntryPayments,
  listTournaments,
  recordTournamentMatchResult,
  releaseTournamentEntryPayout,
  updateTournamentMatchLiveScore,
} from "../services/tournament.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";

export const getAdminTournaments = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await listTournaments(request.query) });
});

export const getAdminTournamentPayments = asyncHandler(async (request, response) => {
  const result = await listTournamentEntryPayments(request.query);
  sendSuccess(response, { data: result.payments, meta: { pagination: result.pagination, metrics: result.metrics } });
});

export const releaseAdminTournamentPayment = asyncHandler(async (request, response) => {
  const payment = await releaseTournamentEntryPayout(request.params.paymentId);
  auditLog({
    action: "admin.tournament_payment.payout_released",
    actorId: request.user.id,
    resourceType: "TournamentEntryPayment",
    resourceId: payment.id,
  });
  sendSuccess(response, { message: "Tournament payout release started", data: payment });
});

export const cancelAdminTournament = asyncHandler(async (request, response) => {
  const tournament = await cancelTournament(request.user.id, request.params.tournamentId, {
    reason: request.body.reason,
    actorRole: "ADMIN",
    requireHost: false,
  });
  emitTournamentUpdated(tournament.id, "tournament_cancelled");
  auditLog({
    action: "admin.tournament.cancelled",
    actorId: request.user.id,
    resourceType: "Tournament",
    resourceId: tournament.id,
    metadata: { reason: request.body.reason },
  });
  sendSuccess(response, { message: "Tournament cancelled and team refund flow started", data: tournament });
});

export const registerAdminTournament = asyncHandler(async (request, response) => {
  try {
    const coverImageUrl = request.file ? `/media/tournaments/${request.file.filename}` : undefined;
    const tournament = await createTournament(request.user.id, { ...request.body, coverImageUrl });
    auditLog({ action: "admin.tournament.created", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
    sendSuccess(response, { statusCode: 201, message: "Tournament created", data: tournament });
  } catch (error) {
    if (request.file) await unlink(request.file.path).catch(() => {});
    throw error;
  }
});

export const createAdminTournamentFixtures = asyncHandler(async (request, response) => {
  const tournament = await generateTournamentFixtures(request.user.id, request.params.tournamentId, { requireHost: false });
  emitTournamentUpdated(tournament.id, "fixtures_generated");
  auditLog({ action: "admin.tournament.fixtures_generated", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { message: "Fixtures generated", data: tournament });
});

export const createAdminTournamentPlayoffs = asyncHandler(async (request, response) => {
  const tournament = await generateTournamentPlayoffs(request.user.id, request.params.tournamentId, { requireHost: false });
  emitTournamentUpdated(tournament.id, "playoffs_generated");
  auditLog({ action: "admin.tournament.playoffs_generated", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { message: "Playoffs generated", data: tournament });
});

export const createAdminTournamentManualMatch = asyncHandler(async (request, response) => {
  const tournament = await createTournamentManualMatch(
    request.user.id,
    request.params.tournamentId,
    request.body,
    { requireHost: false },
  );
  emitTournamentUpdated(tournament.id, "manual_match_created");
  auditLog({ action: "admin.tournament.match_created", actorId: request.user.id, resourceType: "Tournament", resourceId: tournament.id });
  sendSuccess(response, { statusCode: 201, message: "Match created", data: tournament });
});

export const updateAdminTournamentMatchResult = asyncHandler(async (request, response) => {
  const tournament = await recordTournamentMatchResult(
    request.user.id,
    request.params.tournamentId,
    request.params.matchId,
    request.body,
    { requireHost: false },
  );
  emitTournamentUpdated(tournament.id, "match_result_saved");
  auditLog({ action: "admin.tournament.match_result", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Match result saved", data: tournament });
});

export const updateAdminTournamentMatchLiveScore = asyncHandler(async (request, response) => {
  const tournament = await updateTournamentMatchLiveScore(
    request.user.id,
    request.params.tournamentId,
    request.params.matchId,
    request.body,
    { requireHost: false },
  );
  emitTournamentUpdated(tournament.id, "match_live_score_updated");
  auditLog({ action: "admin.tournament.match_live_score", actorId: request.user.id, resourceType: "TournamentMatch", resourceId: request.params.matchId });
  sendSuccess(response, { message: "Live score updated", data: tournament });
});
