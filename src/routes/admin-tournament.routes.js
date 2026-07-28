import { Router } from "express";
import {
  cancelAdminTournament,
  createAdminTournamentManualMatch,
  createAdminTournamentFixtures,
  createAdminTournamentPlayoffs,
  getAdminTournaments,
  getAdminTournamentPayments,
  registerAdminTournament,
  releaseAdminTournamentPayment,
  updateAdminTournamentMatchLiveScore,
  updateAdminTournamentMatchResult,
} from "../controllers/admin-tournament.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { uploadTournamentCover } from "../middlewares/upload.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createTournamentManualMatchSchema,
  createTournamentSchema,
  cancelTournamentSchema,
  listTournamentsSchema,
  listTournamentPaymentsSchema,
  tournamentIdSchema,
  tournamentMatchLiveScoreSchema,
  tournamentMatchResultSchema,
} from "../schemas/user.schema.js";

const router = Router();

router.use(authenticate, authorizeRoles("ADMIN"));
router.get("/", validate(listTournamentsSchema), getAdminTournaments);
router.get("/payments", validate(listTournamentPaymentsSchema), getAdminTournamentPayments);
router.patch("/payments/:paymentId/release", releaseAdminTournamentPayment);
router.post("/", uploadTournamentCover, validate(createTournamentSchema), registerAdminTournament);
router.post("/:tournamentId/fixtures", validate(tournamentIdSchema), createAdminTournamentFixtures);
router.post("/:tournamentId/playoffs", validate(tournamentIdSchema), createAdminTournamentPlayoffs);
router.patch("/:tournamentId/cancel", validate(cancelTournamentSchema), cancelAdminTournament);
router.post("/:tournamentId/matches", validate(createTournamentManualMatchSchema), createAdminTournamentManualMatch);
router.patch("/:tournamentId/matches/:matchId/live-score", validate(tournamentMatchLiveScoreSchema), updateAdminTournamentMatchLiveScore);
router.patch("/:tournamentId/matches/:matchId/result", validate(tournamentMatchResultSchema), updateAdminTournamentMatchResult);

export default router;
