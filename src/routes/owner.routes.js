import { Router } from "express";
import {
  cancelBookedUserSlot,
  cancelOwnerTournament,
  changeOwnerSlot,
  createOwnerTournamentFixtures,
  createOwnerTournamentManualMatch,
  createOwnerTournamentPlayoffs,
  createSlotSchedule,
  bulkChangeOwnerSlots,
  cancelOwnerOpenMatch,
  getOwnerSlots,
  getOwnerTournamentPayments,
  getOwnerBookings,
  getOwnerBlockedSlots,
  getOwnerBookingPayments,
  getOwnerUnbookedSlots,
  getOwnerLocationCities,
  getOwnerLocationStates,
  getOwnerOpenMatchPayments,
  saveOwnerOpenMatchOfflineCollection,
  getOwnerTournaments,
  getOwnerTurfs,
  getProfile,
  registerOwnerTournament,
  registerOwnerVenue,
  resolveOwnerLocation,
  saveOwnerPayoutDetails,
  searchOwnerLocations,
  updateOwnerTournamentMatchResult,
  updateOwnerTournamentMatchLiveScore,
} from "../controllers/owner.controller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { uploadTournamentCover, uploadTurfImages } from "../middlewares/upload.middleware.js";
import {
  createSlotScheduleSchema,
  createOwnerVenueSchema,
  listCitiesByStateSchema,
  listOwnerSlotsSchema,
  reverseGeocodeSchema,
  searchLocationSchema,
  bulkUpdateOwnerSlotsSchema,
  cancelOwnerBookingSchema,
  cancelOpenMatchSchema,
  confirmOpenMatchOfflineCollectionSchema,
  updateOwnerPayoutDetailsSchema,
  updateOwnerSlotSchema,
} from "../schemas/owner.schema.js";
import { listDirectBookingPaymentsSchema, listOpenMatchPaymentsSchema } from "../schemas/admin-booking.schema.js";
import {
  bookingIdSchema,
  cancelTournamentSchema,
  createTournamentManualMatchSchema,
  createTournamentSchema,
  listTournamentPaymentsSchema,
  listTournamentsSchema,
  tournamentIdSchema,
  tournamentMatchLiveScoreSchema,
  tournamentMatchResultSchema,
} from "../schemas/user.schema.js";

const router = Router();
router.use(authenticate, authorizeRoles("TURF_OWNER"));
router.get("/profile", getProfile);
router.patch("/profile/payout-details", validate(updateOwnerPayoutDetailsSchema), saveOwnerPayoutDetails);
router.get("/location/reverse", validate(reverseGeocodeSchema), resolveOwnerLocation);
router.get("/location/search", validate(searchLocationSchema), searchOwnerLocations);
router.get("/location/states", getOwnerLocationStates);
router.get("/location/cities", validate(listCitiesByStateSchema), getOwnerLocationCities);
router.get("/turfs", getOwnerTurfs);
router.get("/booking-payments", validate(listDirectBookingPaymentsSchema), getOwnerBookingPayments);
router.get("/open-match-payments", validate(listOpenMatchPaymentsSchema), getOwnerOpenMatchPayments);
router.patch("/open-match-payments/:matchId/offline-collection", validate(confirmOpenMatchOfflineCollectionSchema), saveOwnerOpenMatchOfflineCollection);
router.patch("/open-match-payments/:matchId/cancel", validate(cancelOpenMatchSchema), cancelOwnerOpenMatch);
router.get("/bookings", getOwnerBookings);
router.get("/unbooked-slots", getOwnerUnbookedSlots);
router.get("/blocked-slots", getOwnerBlockedSlots);
router.patch("/bookings/:bookingId/cancel", validate(cancelOwnerBookingSchema), cancelBookedUserSlot);
router.post("/turfs", uploadTurfImages, validate(createOwnerVenueSchema), registerOwnerVenue);
router.get("/turfs/:turfId/slots", validate(listOwnerSlotsSchema), getOwnerSlots);
router.post("/turfs/:turfId/slots/generate", validate(createSlotScheduleSchema), createSlotSchedule);
router.patch("/turfs/:turfId/slots/bulk", validate(bulkUpdateOwnerSlotsSchema), bulkChangeOwnerSlots);
router.patch("/turfs/:turfId/slots/:slotId", validate(updateOwnerSlotSchema), changeOwnerSlot);
router.get("/tournament-payments", validate(listTournamentPaymentsSchema), getOwnerTournamentPayments);
router.get("/tournaments", validate(listTournamentsSchema), getOwnerTournaments);
router.post("/tournaments", uploadTournamentCover, validate(createTournamentSchema), registerOwnerTournament);
router.post("/tournaments/:tournamentId/fixtures", validate(tournamentIdSchema), createOwnerTournamentFixtures);
router.post("/tournaments/:tournamentId/playoffs", validate(tournamentIdSchema), createOwnerTournamentPlayoffs);
router.patch("/tournaments/:tournamentId/cancel", validate(cancelTournamentSchema), cancelOwnerTournament);
router.post("/tournaments/:tournamentId/matches", validate(createTournamentManualMatchSchema), createOwnerTournamentManualMatch);
router.patch("/tournaments/:tournamentId/matches/:matchId/live-score", validate(tournamentMatchLiveScoreSchema), updateOwnerTournamentMatchLiveScore);
router.patch("/tournaments/:tournamentId/matches/:matchId/result", validate(tournamentMatchResultSchema), updateOwnerTournamentMatchResult);

export default router;
