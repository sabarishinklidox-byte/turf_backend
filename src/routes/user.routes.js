import { Router } from "express";
import {
  cancelBooking,
  cancelMyOpenMatch,
  createBookingOrder,
  createBooking,
  createOpenMatch,
  createOpenMatchJoinOrder,
  createOpenMatchOrder,
  createTournamentEntryOrder,
  createUserTeam,
  getBookings,
  getCommunityOpenMatches,
  getLeaders,
  getMyOpenMatches,
  getNotifications,
  getOpenMatches,
  getSlots,
  getTeams,
  getTurf,
  getTurfWeather,
  getTurfs,
  getTournament,
  getTournamentPlayerEmailStatus,
  getTournaments,
  getUserTeamMemberStatus,
  inviteTournamentPlayer,
  inviteUserTeamMember,
  joinTournament,
  joinOpenMatch,
  readNotification,
  submitOpenMatchResult,
  updateUserTeam,
  updateTournamentMatchLiveScoreHandler,
  updateUserLocation,
  verifyOpenMatchJoinPaymentHandler,
  verifyOpenMatchPayment,
  verifyBookingPayment,
  verifyTournamentEntryPayment,
} from "../controllers/user.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { uploadTeamLogo } from "../middlewares/upload.middleware.js";
import {
  bookingIdSchema,
  createBookingPaymentOrderSchema,
  createBookingSchema,
  createOpenMatchJoinPaymentOrderSchema,
  createOpenMatchPaymentOrderSchema,
  createOpenMatchSchema,
  createTournamentEntryPaymentOrderSchema,
  createUserTeamSchema,
  joinTournamentSchema,
  joinOpenMatchSchema,
  inviteTournamentPlayerSchema,
  inviteTeamMemberSchema,
  listTournamentsSchema,
  listOpenMatchesSchema,
  notificationIdSchema,
  openMatchIdSchema,
  listPublicSlotsSchema,
  listPublicTurfsSchema,
  publicTurfIdSchema,
  submitOpenMatchResultSchema,
  tournamentIdSchema,
  tournamentPlayerEmailStatusSchema,
  teamMemberStatusSchema,
  tournamentMatchLiveScoreSchema,
  updateUserTeamSchema,
  updateUserLocationSchema,
  verifyOpenMatchJoinPaymentSchema,
  verifyOpenMatchPaymentSchema,
  verifyBookingPaymentSchema,
  verifyTournamentEntryPaymentSchema,
} from "../schemas/user.schema.js";

const router = Router();

router.get("/turfs", validate(listPublicTurfsSchema), getTurfs);
router.get("/turfs/:turfId", validate(publicTurfIdSchema), getTurf);
router.get("/turfs/:turfId/weather", validate(publicTurfIdSchema), getTurfWeather);
router.get("/turfs/:turfId/slots", validate(listPublicSlotsSchema), getSlots);
router.get("/open-matches", validate(listOpenMatchesSchema), getOpenMatches);
router.get("/open-matches/community", getCommunityOpenMatches);
router.get("/leaders", getLeaders);
router.get("/tournaments", validate(listTournamentsSchema), getTournaments);
router.get("/tournaments/:tournamentId", validate(tournamentIdSchema), getTournament);

router.use(authenticate, authorizeRoles("USER"));

router.post("/bookings", validate(createBookingSchema), createBooking);
router.post("/bookings/payment-order", validate(createBookingPaymentOrderSchema), createBookingOrder);
router.post("/bookings/verify-payment", validate(verifyBookingPaymentSchema), verifyBookingPayment);
router.get("/bookings", getBookings);
router.get("/teams", getTeams);
router.post("/teams", uploadTeamLogo, validate(createUserTeamSchema), createUserTeam);
router.put("/teams/:teamId", uploadTeamLogo, validate(updateUserTeamSchema), updateUserTeam);
router.get("/teams/member-status", validate(teamMemberStatusSchema), getUserTeamMemberStatus);
router.post("/teams/member-invites", validate(inviteTeamMemberSchema), inviteUserTeamMember);
router.patch("/bookings/:bookingId/cancel", validate(bookingIdSchema), cancelBooking);
router.get("/open-matches/my", getMyOpenMatches);
router.post("/open-matches/payment-order", validate(createOpenMatchPaymentOrderSchema), createOpenMatchOrder);
router.post("/open-matches/verify-payment", validate(verifyOpenMatchPaymentSchema), verifyOpenMatchPayment);
router.post("/open-matches", validate(createOpenMatchSchema), createOpenMatch);
router.post("/open-matches/:matchId/join/payment-order", validate(createOpenMatchJoinPaymentOrderSchema), createOpenMatchJoinOrder);
router.post("/open-matches/:matchId/join/verify-payment", validate(verifyOpenMatchJoinPaymentSchema), verifyOpenMatchJoinPaymentHandler);
router.post("/open-matches/:matchId/join", validate(joinOpenMatchSchema), joinOpenMatch);
router.patch("/open-matches/:matchId/cancel", validate(openMatchIdSchema), cancelMyOpenMatch);
router.patch("/open-matches/:matchId/result", validate(submitOpenMatchResultSchema), submitOpenMatchResult);
router.get("/tournaments/:tournamentId/player-email-status", validate(tournamentPlayerEmailStatusSchema), getTournamentPlayerEmailStatus);
router.post("/tournaments/:tournamentId/player-invites", validate(inviteTournamentPlayerSchema), inviteTournamentPlayer);
router.post("/tournaments/:tournamentId/teams/payment-order", validate(createTournamentEntryPaymentOrderSchema), createTournamentEntryOrder);
router.post("/tournaments/:tournamentId/teams/verify-payment", validate(verifyTournamentEntryPaymentSchema), verifyTournamentEntryPayment);
router.post("/tournaments/:tournamentId/teams", validate(joinTournamentSchema), joinTournament);
router.patch("/tournaments/:tournamentId/matches/:matchId/live-score", validate(tournamentMatchLiveScoreSchema), updateTournamentMatchLiveScoreHandler);
router.get("/notifications", getNotifications);
router.patch("/notifications/:notificationId/read", validate(notificationIdSchema), readNotification);
router.patch("/location", validate(updateUserLocationSchema), updateUserLocation);

export default router;
