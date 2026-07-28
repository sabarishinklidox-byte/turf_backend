  import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { sendEmail } from "./email.service.js";
import { getCancellationPolicyRecord, resolveCancellationPlan } from "./cancellation-policy.service.js";
import {
  createRazorpayBookingOrder,
  createRazorpayOrder,
  getActiveBookingPaymentGatewayConfig,
  verifyRazorpayPaymentSignature,
} from "./payment-gateway.service.js";
import {
  createBookingRefund,
  reconcileDirectBookingPayoutAutomation,
  reconcileDirectBookingPayoutAutomationBatch,
} from "./booking-payment-automation.service.js";
import { AppError } from "../utils/app-error.js";
import { distanceKm, notifyNearbyUsersForOpenMatch } from "./notification.service.js";

const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();
const INDIA_OFFSET = "+05:30";
const openMatchOfflinePaymentRule =
  "Host pays one share first. If minimum players join, the match can happen. If some player spots remain unfilled, the joined players must split and pay the remaining amount directly to the turf owner at the venue. After the match ends, the online collected amount will be released separately. If all players join, no extra offline payment is needed. If minimum players are not reached before match start, the match is cancelled and refunds are issued.";
const openMatchTeamPaymentRule =
  "Host team pays one full team share first. The opponent team joins by paying the matching full team share online. If the opponent team does not join before match start, the host team payment is refunded. Once both teams join, the match is confirmed with no offline split payment. After the match ends, the collected online amount is released to the turf owner.";

const addDays = (dateString, days) => {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const toDateTime = (date, minutes = 0) => {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return new Date(`${date}T${hours}:${mins}:00${INDIA_OFFSET}`);
};

const bookingCode = () => `BK-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
const bookingPaymentReceipt = () => `BKP-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
const matchCode = () => `OM-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
const openMatchPaymentReceipt = () => `OMP-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
const MIN_TEAM_MATCH_SIZE = 2;
const MAX_TEAM_MATCH_SIZE = 15;
const OPEN_MATCH_JOINABLE_STATUSES = ["OPEN", "FILLING", "MIN_READY"];
const OPEN_MATCH_TERMINAL_STATUSES = ["CANCELLED", "CANCELLED_REFUND", "COMPLETED"];

const openMatchCutoffAt = (match) => match.sessionStartAt ?? match.slot?.startAt ?? null;

export const deriveOpenMatchStatus = (match, now = new Date()) => {
  if (OPEN_MATCH_TERMINAL_STATUSES.includes(match.status)) return match.status;

  const spotsFilled = Number(match.spotsFilled ?? 0);
  const minPlayers = Number(match.minPlayers ?? match.maxPlayers ?? 2);
  const maxPlayers = Number(match.maxPlayers ?? minPlayers);
  const cutoffAt = openMatchCutoffAt(match);
  const cutoffPassed = cutoffAt ? new Date(cutoffAt) <= now : false;
  const endAt = match?.sessionEndAt ?? match?.slot?.endAt ?? null;
  const matchEnded = endAt ? new Date(endAt) <= now : false;

  if (cutoffPassed && spotsFilled < minPlayers) return "CANCELLED_REFUND";
  if (matchEnded && spotsFilled >= minPlayers) return "COMPLETED";
  if (spotsFilled >= maxPlayers) return "CONFIRMED_FULL";
  if (cutoffPassed && spotsFilled >= minPlayers) return "CONFIRMED_PARTIAL";
  if (spotsFilled >= minPlayers) return "MIN_READY";
  return "FILLING";
};

const isOpenMatchJoinableStatus = (status) => OPEN_MATCH_JOINABLE_STATUSES.includes(status);

const serializeTurf = (turf) => ({
  id: turf.id,
  registrationNumber: turf.registrationNumber,
  turfName: turf.name,
  description: turf.description,
  address: turf.address,
  city: turf.city,
  state: turf.state,
  postalCode: turf.postalCode,
  landmark: turf.landmark,
  latitude: turf.latitude,
  longitude: turf.longitude,
  sports: turf.sports,
  surfaceType: turf.surfaceType,
  openingTime: turf.openingTime,
  closingTime: turf.closingTime,
  amenities: turf.amenities,
  imageUrls: turf.imageUrls,
  ownerName: turf.ownerName,
  cancellationPolicy: {
    source: turf.bookingCancellationOverrideEnabled || turf.openMatchCancellationOverrideEnabled ? "VENUE" : "MASTER",
    bookingOverrideEnabled: Boolean(turf.bookingCancellationOverrideEnabled),
    bookingFullRefundHours: turf.bookingCancellationFullRefundHours ?? null,
    bookingPartialRefundHours: turf.bookingCancellationPartialRefundHours ?? null,
    bookingPartialRefundPercent: turf.bookingCancellationPartialRefundPercent ?? null,
    bookingNoRefundHours: turf.bookingCancellationNoRefundHours ?? null,
    openMatchOverrideEnabled: Boolean(turf.openMatchCancellationOverrideEnabled),
    openMatchFullRefundHours: turf.openMatchCancellationFullRefundHours ?? null,
    openMatchPartialRefundHours: turf.openMatchCancellationPartialRefundHours ?? null,
    openMatchPartialRefundPercent: turf.openMatchCancellationPartialRefundPercent ?? null,
    openMatchNoRefundHours: turf.openMatchCancellationNoRefundHours ?? null,
  },
  pricePerHour: turf.pricePerHour ?? null,
  slotCount: turf._count?.slots ?? 0,
});

const serializeSlot = (slot) => ({
  id: slot.id,
  turfId: slot.turfId,
  startAt: slot.startAt,
  endAt: slot.endAt,
  price: slot.price,
  status: slot.status,
});

const serializeReservedSlot = (reservedSlot) => ({
  id: reservedSlot.id,
  position: reservedSlot.position,
  slot: serializeSlot(reservedSlot.slot),
});

const serializeUserTeamMember = (member) => ({
  id: member.id,
  userId: member.userId,
  displayName: member.displayName,
  email: member.email,
  mobileNumber: member.mobileNumber,
  role: member.role,
});

const serializeUserTeam = (team) => ({
  id: team.id,
  name: team.name,
  logoUrl: team.logoUrl ?? null,
  sport: team.sport,
  sports: team.sports ?? [],
  isActive: team.isActive,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
  memberCount: team.members?.length ?? 0,
  members: team.members?.map(serializeUserTeamMember) ?? [],
});

const getUserBookingCancellationPlan = (booking, cancellationPolicy) =>
  resolveCancellationPlan({
    policy: cancellationPolicy,
    turf: booking?.turf ?? null,
    kind: "BOOKING",
    startAt: booking?.slot?.startAt ?? null,
    amount: Number(booking?.price ?? 0),
  });

const getUserBookingFinancials = (booking, cancellationPlan, latestRefundAmount = 0) => {
  const totalPaidAmount = booking?.paymentId ? Number(booking?.price ?? 0) : 0;
  const expectedRefundAmount =
    latestRefundAmount > 0
      ? latestRefundAmount
      : booking?.status === "CANCELLED" && booking?.paymentId
        ? Math.max(0, Number(cancellationPlan?.refundAmount ?? 0))
        : 0;
  const retainedAmount = Math.max(0, totalPaidAmount - Math.min(totalPaidAmount, expectedRefundAmount));

  let settlementState = "NO_ONLINE_PAYMENT";
  if (totalPaidAmount > 0 && booking?.status !== "CANCELLED") settlementState = "HELD_IN_PLATFORM";
  else if (totalPaidAmount > 0 && retainedAmount <= 0) settlementState = "FULL_REFUND_TO_USER";
  else if (totalPaidAmount > 0 && booking?.refundStatus === "FAILED") settlementState = "REFUND_FAILED_HOLD";
  else if (totalPaidAmount > 0 && retainedAmount > 0) settlementState = "RETAINED_FOR_TURF_OWNER";

  return {
    totalPaidAmount,
    refundAmount: expectedRefundAmount,
    retainedAmount,
    payoutRecipient: retainedAmount > 0 ? "TURF_OWNER" : "USER",
    settlementState,
  };
};

const serializeBooking = (booking, cancellationPolicy = null) => {
  const cancellationPlan = getUserBookingCancellationPlan(booking, cancellationPolicy);
  const latestRefund = booking.paymentRefunds?.[0] ?? null;
  const latestRefundAmount = Number(latestRefund?.amount ?? 0);
  const financials = getUserBookingFinancials(booking, cancellationPlan, latestRefundAmount);

  return {
  id: booking.id,
  bookingCode: booking.bookingCode,
  status: booking.status,
  paymentStatus: booking.paymentStatus,
  paymentProvider: booking.paymentProvider ?? null,
  paymentOrderId: booking.paymentOrderId ?? null,
  paymentId: booking.paymentId ?? null,
  paymentCapturedAt: booking.paymentCapturedAt ?? null,
  payoutStatus: booking.payoutStatus ?? null,
  payoutMethod: booking.payoutMethod ?? null,
  payoutReference: booking.payoutReference ?? null,
  payoutReleasedAt: booking.payoutReleasedAt ?? null,
  payoutFailureReason: booking.payoutFailureReason ?? null,
  refundStatus: booking.refundStatus ?? null,
  refundedAt: booking.refundedAt ?? null,
  refundFailureReason: booking.refundFailureReason ?? null,
  cancellationReason: booking.cancellationReason ?? null,
  cancelledByRole: booking.cancelledByRole ?? null,
  price: booking.price,
  createdAt: booking.createdAt,
  cancelledAt: booking.cancelledAt,
  canCancelBooking: Boolean(booking.status === "CONFIRMED") && cancellationPlan.canCancel,
  cancellationPolicy: {
    canCancel: cancellationPlan.canCancel,
    refundPercent: cancellationPlan.refundPercent,
    refundAmount: cancellationPlan.refundAmount,
    retainedAmount: financials.retainedAmount,
    remainingHours: cancellationPlan.remainingHours,
    tier: cancellationPlan.tier,
    fullRefundHours: cancellationPlan.policyWindow?.fullRefundHours ?? null,
    partialRefundHours: cancellationPlan.policyWindow?.partialRefundHours ?? null,
    noRefundHours: cancellationPlan.policyWindow?.noRefundHours ?? null,
    source: cancellationPlan.source ?? "MASTER",
  },
  financials,
  paymentNote:
    booking.status === "CANCELLED"
      ? booking.paymentStatus === "REFUNDED" || latestRefundAmount >= Number(booking.price ?? 0)
        ? latestRefundAmount > 0 && latestRefundAmount < Number(booking.price ?? 0)
          ? "This slot booking was cancelled and a partial refund was completed to the original payment source."
          : "This slot booking was cancelled and the payment was refunded to the original payment source."
        : booking.refundStatus === "FAILED"
          ? "This slot booking was cancelled, but the refund could not be completed yet."
          : booking.paymentId && cancellationPlan.tier === "NO_REFUND"
            ? "This slot booking was cancelled inside the no-refund window. No refund was applied."
          : booking.paymentId
            ? "This slot booking was cancelled. Refund tracking is active for the original payment source."
            : "This slot booking was cancelled."
      : "This slot booking payment is confirmed.",
  refunds:
    booking.paymentRefunds?.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      receipt: refund.receipt,
      razorpayPaymentId: refund.razorpayPaymentId,
      razorpayRefundId: refund.razorpayRefundId ?? null,
      status: refund.status,
      failureReason: refund.failureReason ?? null,
      requestedAt: refund.requestedAt,
      processedAt: refund.processedAt ?? null,
      failedAt: refund.failedAt ?? null,
    })) ?? [],
  slot: serializeSlot(booking.slot),
  turf: serializeTurf(booking.turf),
  };
};

const serializeOpenMatchParticipant = (participant) => ({
  id: participant.id,
  kind: participant.kind,
  status: participant.status,
  teamName: participant.teamName,
  userTeam: participant.userTeam ? serializeUserTeam(participant.userTeam) : null,
  playerCount: participant.playerCount,
  selectedMemberIds: participant.selectedMemberIds ?? [],
  amountPaid: participant.amountPaid,
  paymentOrderId: participant.paymentOrderId ?? null,
  paymentId: participant.paymentId ?? null,
  paymentCapturedAt: participant.paymentCapturedAt ?? null,
  refundStatus: participant.refundStatus ?? null,
  refundedAt: participant.refundedAt ?? null,
  refundFailureReason: participant.refundFailureReason ?? null,
  joinedAt: participant.joinedAt,
  cancelledAt: participant.cancelledAt ?? null,
  refunds:
    participant.refunds?.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      receipt: refund.receipt,
      razorpayPaymentId: refund.razorpayPaymentId,
      razorpayRefundId: refund.razorpayRefundId ?? null,
      status: refund.status,
      failureReason: refund.failureReason ?? null,
      requestedAt: refund.requestedAt,
      processedAt: refund.processedAt ?? null,
      failedAt: refund.failedAt ?? null,
    })) ?? [],
  user: participant.user
    ? {
        id: participant.user.id,
        firstName: participant.user.firstName,
        lastName: participant.user.lastName,
      }
    : undefined,
});

export const isTeamBasedOpenMatch = (match) =>
  ["TEAM_VS_TEAM", "NEED_OPPONENT_TEAM"].includes(match?.matchType);

const getOpenMatchPaymentRuleText = (matchType) =>
  ["TEAM_VS_TEAM", "NEED_OPPONENT_TEAM"].includes(matchType)
    ? openMatchTeamPaymentRule
    : openMatchOfflinePaymentRule;

const getOpenMatchCollectionModel = (match) =>
  isTeamBasedOpenMatch(match) ? "TEAM_FULLY_ONLINE" : "SOLO_SPLIT_OFFLINE";

const getOpenMatchParticipantRefundAmount = (participant) => {
  if (participant?.refundStatus === "FAILED") return 0;
  const latestRefund = participant?.refunds?.[0] ?? null;
  return Math.max(0, Number(latestRefund?.amount ?? 0));
};

const getOpenMatchParticipantHeldAmount = (participant) => {
  const paidAmount = Math.max(0, Number(participant?.amountPaid ?? 0));
  if (paidAmount <= 0) return 0;
  if (participant?.status === "REFUNDED" && !participant?.refunds?.length) return 0;
  return Math.max(0, paidAmount - getOpenMatchParticipantRefundAmount(participant));
};

export const getOpenMatchEndAt = (match) => match?.sessionEndAt ?? match?.slot?.endAt ?? null;

export const hasOpenMatchEnded = (match) => {
  const endAt = getOpenMatchEndAt(match);
  return endAt ? new Date(endAt) <= new Date() : false;
};

const hasOpenMatchPayoutDestination = (match) => {
  const turf = match?.turf;
  if (!turf?.payoutMethod) return false;

  if (turf.payoutMethod === "UPI") {
    return Boolean(turf.payoutUpiId?.trim());
  }

  return Boolean(
    turf.payoutAccountHolderName?.trim() &&
      turf.payoutBankName?.trim() &&
      turf.payoutAccountNumber?.trim() &&
      turf.payoutIfscCode?.trim(),
  );
};

const getOpenMatchFinancialSnapshot = (match, now = new Date()) => {
  const collectionModel = getOpenMatchCollectionModel(match);
  const teamBased = collectionModel === "TEAM_FULLY_ONLINE";
  const paidParticipants = (match.participants ?? []).filter((participant) => participant.status === "PAID");
  const totalCollectedAmount = (match.participants ?? []).reduce(
    (sum, participant) => sum + getOpenMatchParticipantHeldAmount(participant),
    0,
  );
  const offlineCollectionAmount = Math.max(0, Number(match.offlineCollectionAmount ?? 0));
  const totalSettledAmount = totalCollectedAmount + offlineCollectionAmount;
  const totalSlotPrice = Math.max(0, Number(match.totalSlotPrice ?? 0));
  const ownerOnlinePayoutAmount = Math.max(0, Math.min(totalCollectedAmount, totalSlotPrice));
  const offlineCollectionTargetAmount = teamBased ? 0 : Math.max(0, totalSlotPrice - ownerOnlinePayoutAmount);
  const status = deriveOpenMatchStatus(match, now);
  const isRefundState = status === "CANCELLED_REFUND";
  const isCancelledState = status === "CANCELLED";
  const participantCollectionsAmount = teamBased ? 0 : Math.max(0, totalCollectedAmount - totalSlotPrice);
  const outstandingCollectionAmount = isRefundState || teamBased ? 0 : Math.max(0, offlineCollectionTargetAmount - offlineCollectionAmount);
  const endAt = getOpenMatchEndAt(match);
  const matchEnded = endAt ? new Date(endAt) <= now : false;
  const resultDisputed = isTeamBasedOpenMatch(match) && match.result?.status === "DISPUTED";
  const resultPending =
    isTeamBasedOpenMatch(match) &&
    matchEnded &&
    match.result &&
    !["CONFIRMED", "DISPUTED"].includes(match.result.status);
  const payoutDestinationReady = hasOpenMatchPayoutDestination(match);

  return {
    endAt,
    collectionModel,
    isCancelledState,
    isRefundState,
    matchEnded,
    offlineCollectionAmount,
    offlineCollectionTargetAmount,
    outstandingCollectionAmount,
    ownerOnlinePayoutAmount,
    participantCollectionsAmount,
    payoutDestinationReady,
    resultDisputed,
    resultPending,
    status,
    totalCollectedAmount,
    totalSettledAmount,
    totalSlotPrice,
  };
};

export const deriveOpenMatchSettlementState = (match, now = new Date()) => {
  const snapshot = getOpenMatchFinancialSnapshot(match, now);

  if (match.payoutStatus === "RELEASED") return "PAYOUT_RELEASED";
  if (match.payoutStatus === "REFUNDED") return "REFUNDED";
  if (snapshot.isRefundState) return "REFUND_REQUIRED";
  if (snapshot.isCancelledState) return "CANCELLED";
  if (!snapshot.matchEnded) return "HELD_UNTIL_MATCH_END";
  if (snapshot.resultDisputed) return "AWAITING_RESULT_RESOLUTION";
  if (snapshot.resultPending) return "AWAITING_CAPTAIN_CONFIRMATION";
  if (snapshot.outstandingCollectionAmount > 0) return "AWAITING_TURF_COLLECTION";
  if (!snapshot.payoutDestinationReady) return "OWNER_PAYOUT_DETAILS_PENDING";
  return "READY_FOR_SETTLEMENT";
};

export const deriveOpenMatchPayoutStatus = (match, now = new Date()) => {
  const settlementState = deriveOpenMatchSettlementState(match, now);

  if (settlementState === "PAYOUT_RELEASED") return "RELEASED";
  if (settlementState === "REFUNDED") return "REFUNDED";
  if (settlementState === "REFUND_REQUIRED") return "REFUND_REQUIRED";
  if (settlementState === "CANCELLED") return "CANCELLED";
  if (settlementState === "READY_FOR_SETTLEMENT") return "ELIGIBLE";
  return "HELD";
};

const getTeamCaptainUserId = (team) =>
  team?.members?.find((member) => member.role === "CAPTAIN")?.userId ?? null;

const dedupeBy = (items, keyFn) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getOpenMatchResultTeams = (match) => {
  if (!isTeamBasedOpenMatch(match) || !match?.hostTeam?.id) return [];

  const opponentParticipants = dedupeBy(
    (match.participants ?? []).filter(
      (participant) =>
        participant.kind === "TEAM" &&
        participant.status === "PAID" &&
        participant.userTeamId &&
        participant.userTeam &&
        participant.userTeamId !== match.hostTeamId,
    ),
    (participant) => participant.userTeamId,
  );

  if (opponentParticipants.length !== 1) return [];

  return [
    {
      slot: "A",
      teamId: match.hostTeam.id,
      teamName: match.hostTeam.name,
      logoUrl: match.hostTeam.logoUrl ?? null,
      captainUserId: getTeamCaptainUserId(match.hostTeam),
    },
    {
      slot: "B",
      teamId: opponentParticipants[0].userTeam.id,
      teamName: opponentParticipants[0].userTeam.name,
      logoUrl: opponentParticipants[0].userTeam.logoUrl ?? null,
      captainUserId: getTeamCaptainUserId(opponentParticipants[0].userTeam),
    },
  ];
};

const serializeOpenMatchResultSubmission = (submission) => ({
  id: submission.id,
  teamId: submission.teamId,
  captainUserId: submission.captainUserId,
  outcome: submission.outcome,
  note: submission.note,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
});

const serializeOpenMatchResult = (match) => {
  if (!isTeamBasedOpenMatch(match) || !hasOpenMatchEnded(match)) return null;

  const teams = getOpenMatchResultTeams(match);
  const submissions = match.result?.submissions ?? [];
  const outcomeByTeamId = new Map(submissions.map((submission) => [submission.teamId, submission.outcome]));

  return {
    status: match.result?.status ?? "PENDING_RESULT",
    confirmedWinnerTeamId: match.result?.confirmedWinnerTeamId ?? null,
    lastSubmittedByTeamId: match.result?.lastSubmittedByTeamId ?? null,
    confirmedAt: match.result?.confirmedAt ?? null,
    disputedAt: match.result?.disputedAt ?? null,
    teams: teams.map((team) => ({
      slot: team.slot,
      teamId: team.teamId,
      teamName: team.teamName,
      logoUrl: team.logoUrl ?? null,
      captainUserId: team.captainUserId,
      submittedOutcome: outcomeByTeamId.get(team.teamId) ?? null,
    })),
    submissions: submissions.map(serializeOpenMatchResultSubmission),
  };
};

const getOpenMatchCommunityState = (match) => {
  if (match?.status === "CANCELLED") return "CANCELLED";
  if (!hasOpenMatchEnded(match)) return "LIVE";
  if (!isTeamBasedOpenMatch(match)) return "COMPLETED";
  return match.result?.status ?? "PENDING_RESULT";
};

export const serializeOpenMatchFinancials = (match, now = new Date()) => {
  const snapshot = getOpenMatchFinancialSnapshot(match, now);
  const settlementState = deriveOpenMatchSettlementState(match, now);
  const payoutStatus = deriveOpenMatchPayoutStatus(match, now);
  const teamBased = snapshot.collectionModel === "TEAM_FULLY_ONLINE";

  return {
    currency: "INR",
    payoutRule: teamBased ? "TEAM_ONLINE_FULL_SETTLEMENT" : "OWNER_FIRST_THEN_HOST_MARGIN",
    collectionModel: snapshot.collectionModel,
    paymentRuleText: getOpenMatchPaymentRuleText(match.matchType),
    totalCollectedAmount: snapshot.totalCollectedAmount,
    offlineCollectionAmount: snapshot.offlineCollectionAmount,
    offlineCollectionTargetAmount: snapshot.offlineCollectionTargetAmount,
    totalSettledAmount: snapshot.totalSettledAmount,
    ownerPayoutAmount: snapshot.isRefundState || snapshot.isCancelledState ? 0 : snapshot.ownerOnlinePayoutAmount,
    outstandingCollectionAmount: snapshot.outstandingCollectionAmount,
    participantCollectionsAmount: snapshot.isRefundState || snapshot.isCancelledState ? 0 : snapshot.participantCollectionsAmount,
    hostPayoutAmount: snapshot.isRefundState || snapshot.isCancelledState || teamBased ? 0 : snapshot.participantCollectionsAmount,
    platformHeldAmount: snapshot.totalCollectedAmount,
    settlementState,
    payoutStatus,
    payoutDestinationReady: snapshot.payoutDestinationReady,
    eligibleAt:
      payoutStatus === "ELIGIBLE" ? match.payoutEligibleAt ?? snapshot.endAt ?? now : match.payoutEligibleAt ?? null,
    payoutReleasedAt: match.payoutReleasedAt ?? null,
    payoutReference: match.payoutReference ?? null,
  };
};

const serializeOpenMatch = (match) => ({
  id: match.id,
  matchCode: match.matchCode,
  title: match.title,
  sport: match.sport,
  matchType: match.matchType,
  status: deriveOpenMatchStatus(match),
  rawStatus: match.status,
  teamSize: match.teamSize,
  minPlayers: match.minPlayers,
  maxPlayers: match.maxPlayers,
  spotsFilled: match.spotsFilled,
  spotsLeft: Math.max(0, match.maxPlayers - match.spotsFilled),
  entryFeePerPlayer: match.entryFeePerPlayer,
  teamEntryFee: match.teamEntryFee,
  sessionStartAt: match.sessionStartAt,
  sessionEndAt: match.sessionEndAt,
  totalSlotPrice: match.totalSlotPrice,
  reservedSlotCount: match.reservedSlotCount,
  createdAt: match.createdAt,
  host: match.host
    ? {
        id: match.host.id,
        firstName: match.host.firstName,
        lastName: match.host.lastName,
      }
    : undefined,
  hostTeam: match.hostTeam ? serializeUserTeam(match.hostTeam) : null,
  turf: match.turf ? serializeTurf(match.turf) : undefined,
  slot: match.slot ? serializeSlot(match.slot) : undefined,
  reservedSlots: match.reservedSlots?.map(serializeReservedSlot) ?? [],
  participants: match.participants?.map(serializeOpenMatchParticipant) ?? [],
  financials: serializeOpenMatchFinancials(match),
  communityState: getOpenMatchCommunityState(match),
  result: serializeOpenMatchResult(match),
});

const publicTurfWhere = ({ search, city, sport } = {}) => ({
  status: "APPROVED",
  isActive: true,
  ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
  ...(sport ? { sports: { has: sport } } : {}),
  ...(search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } },
          { state: { contains: search, mode: "insensitive" } },
          { sports: { has: search } },
        ],
      }
    : {}),
});

const normalizeTeamMemberEmail = (email) => {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
};

const normalizeTeamMemberPhone = (mobileNumber) => {
  const trimmed = mobileNumber?.trim();
  return trimmed || null;
};

const getUserDisplayName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "player";

const queueOpenMatchAutomation = (matchIds = []) => {
  const ids = [...new Set(matchIds.filter(Boolean))];
  if (ids.length === 0) return;
  import("./open-match-automation.service.js")
    .then(({ reconcileOpenMatchAutomationBatch }) => reconcileOpenMatchAutomationBatch(ids))
    .catch((error) => logger.error({ error, matchIds: ids }, "Open match automation queue failed"));
};

const getOpenMatchDeepLink = (matchId) => `${appBaseUrl.replace(/\/$/, "")}/user/join-play`;
const getBookingDeepLink = () => `${appBaseUrl.replace(/\/$/, "")}/user/bookings`;

const formatCurrencyInr = (amount = 0) => `Rs. ${Number(amount ?? 0).toLocaleString("en-IN")}`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getPaymentReferenceLine = (payment) => {
  if (!payment?.paymentId && !payment?.paymentOrderId) return "Payment: No online payment reference";
  return [
    payment?.paymentId ? `Payment ID: ${payment.paymentId}` : null,
    payment?.paymentOrderId ? `Order ID: ${payment.paymentOrderId}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
};

const sendDirectBookingNotifications = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
      turf: true,
      slot: true,
    },
  });

  if (!booking) return;

  const bookingLink = getBookingDeepLink();
  const userName = getUserDisplayName(booking.user);
  const ownerName = booking.turf?.ownerName?.trim() || "turf owner";
  const slotTime = booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Slot time not set";
  const venueLine = [booking.turf?.name, booking.turf?.city, booking.turf?.state].filter(Boolean).join(", ");
  const paymentLine = getPaymentReferenceLine(booking);
  const paidAmountLine = formatCurrencyInr(booking.price);

  if (booking.user?.email) {
    await sendEmail({
      to: booking.user.email,
      subject: `Your PlayArena booking is confirmed: ${booking.bookingCode}`,
      text: `Hi ${userName},\n\nYour slot booking is confirmed.\n\nBooking: ${booking.bookingCode}\nVenue: ${venueLine || "PlayArena venue"}\nTime: ${slotTime}\nAmount: ${paidAmountLine}\n${paymentLine}\n\nOpen your bookings here:\n${bookingLink}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(userName)},</p>
          <h2 style="margin:0 0 12px;">Your slot booking is confirmed</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(booking.bookingCode)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(slotTime)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payment details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">Amount paid: ${escapeHtml(paidAmountLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">${escapeHtml(paymentLine)}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${bookingLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open My Bookings
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    }).catch((error) => {
      logger.error({ error, bookingId: booking.id, email: booking.user.email }, "Direct booking user email failed");
    });
  }

  if (booking.turf?.ownerEmail) {
    await sendEmail({
      to: booking.turf.ownerEmail,
      subject: `New slot booking received on PlayArena: ${booking.bookingCode}`,
      text: `Hi ${ownerName},\n\nA new slot has been booked on PlayArena.\n\nBooking: ${booking.bookingCode}\nVenue: ${booking.turf?.name ?? "Your turf"}\nPlayer: ${userName}${booking.user?.phone ? ` (${booking.user.phone})` : ""}\nTime: ${slotTime}\nCollected online: ${paidAmountLine}\n${paymentLine}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(ownerName)},</p>
          <h2 style="margin:0 0 12px;">New slot booking received</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(booking.bookingCode)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${escapeHtml(booking.turf?.name ?? "Your turf")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(slotTime)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Booking details</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">Player: ${escapeHtml(userName)}${booking.user?.phone ? ` (${escapeHtml(booking.user.phone)})` : ""}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">Collected online: ${escapeHtml(paidAmountLine)}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">${escapeHtml(paymentLine)}</div>
          </div>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    }).catch((error) => {
      logger.error({ error, bookingId: booking.id, email: booking.turf.ownerEmail }, "Direct booking owner email failed");
    });
  }
};

const sendOpenMatchUserEmail = async ({ user, match, subject, heading, intro, paymentSummary = null }) => {
  if (!user?.email || !match) return;

  const venueLine = [match.turf?.turfName ?? match.turf?.name, match.turf?.city, match.turf?.state].filter(Boolean).join(", ");
  const startAt = match.sessionStartAt ?? match.slot?.startAt ?? null;
  const ruleText = getOpenMatchPaymentRuleText(match.matchType);
  const link = getOpenMatchDeepLink(match.id);
  const paymentDetails = paymentSummary
    ? [
        `Amount paid now: ${formatCurrencyInr(paymentSummary.amount)}`,
        paymentSummary.paymentId ? `Payment ID: ${paymentSummary.paymentId}` : null,
        paymentSummary.paymentOrderId ? `Order ID: ${paymentSummary.paymentOrderId}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Payment status: No online payment was required for this step.";
  const paymentDetailsHtml = paymentSummary
    ? [
        `<div style="margin-top:8px;font-size:14px;color:#10245e;">Amount paid now: ${escapeHtml(formatCurrencyInr(paymentSummary.amount))}</div>`,
        paymentSummary.paymentId
          ? `<div style="margin-top:4px;font-size:14px;color:#10245e;">Payment ID: ${escapeHtml(paymentSummary.paymentId)}</div>`
          : "",
        paymentSummary.paymentOrderId
          ? `<div style="margin-top:4px;font-size:14px;color:#10245e;">Order ID: ${escapeHtml(paymentSummary.paymentOrderId)}</div>`
          : "",
      ].join("")
    : `<div style="margin-top:8px;font-size:14px;color:#10245e;">Payment status: No online payment was required for this step.</div>`;

  try {
    await sendEmail({
      to: user.email,
      subject,
      text: `Hi ${getUserDisplayName(user)},\n\n${intro}\n\nMatch: ${match.title}\nSport: ${match.sport}\nVenue: ${venueLine || "PlayArena venue"}\nStart: ${startAt ? formatDateTimeForEmail(startAt) : "Will be announced"}\n\n${paymentDetails}\n\nPayment rule:\n${ruleText}\n\nOpen match:\n${link}\n\n- PlayArena`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #10245e; line-height: 1.6;">
          <p style="margin:0 0 8px;">Hi ${getUserDisplayName(user)},</p>
          <h2 style="margin:0 0 12px;">${heading}</h2>
          <p style="margin:0 0 12px;">${intro}</p>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${match.title}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${match.sport}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${venueLine || "PlayArena venue"}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${startAt ? formatDateTimeForEmail(startAt) : "Start time will be announced"}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payment details</div>
            ${paymentDetailsHtml}
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Payment rule</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">${ruleText}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Join & Play
            </a>
          </p>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, matchId: match.id, email: user.email }, "Open match email failed");
  }
};

const sendOpenMatchOwnerEmail = async ({ match, hostUser, paymentSummary = null }) => {
  const ownerEmail = match?.turf?.ownerEmail;
  if (!ownerEmail || !match) return;

  const ownerName = match.turf?.ownerName?.trim() || "turf owner";
  const venueLine = [match.turf?.turfName ?? match.turf?.name, match.turf?.city, match.turf?.state].filter(Boolean).join(", ");
  const startAt = match.sessionStartAt ?? match.slot?.startAt ?? null;
  const timeLine = startAt ? formatDateTimeForEmail(startAt) : "Start time will be announced";
  const hostName = getUserDisplayName(hostUser);
  const paymentLine = paymentSummary
    ? `Collected online now: ${formatCurrencyInr(paymentSummary.amount)}${paymentSummary.paymentId ? ` | Payment ID: ${paymentSummary.paymentId}` : ""}`
    : "Collected online now: No online payment captured at creation";

  try {
    await sendEmail({
      to: ownerEmail,
      subject: `New host match booking on PlayArena: ${match.title}`,
      text: `Hi ${ownerName},\n\nA host match has reserved slots on your venue.\n\nMatch: ${match.title}\nCode: ${match.matchCode}\nHost: ${hostName}${hostUser?.phone ? ` (${hostUser.phone})` : ""}\nVenue: ${venueLine || "PlayArena venue"}\nStart: ${timeLine}\n${paymentLine}\n\n- PlayArena`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10245e;line-height:1.6;">
          <p style="margin:0 0 8px;">Hi ${escapeHtml(ownerName)},</p>
          <h2 style="margin:0 0 12px;">A host match reserved slots on your venue</h2>
          <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
            <div style="font-size:18px;font-weight:800;color:#10245e;">${escapeHtml(match.title)}</div>
            <div style="margin-top:6px;font-size:14px;color:#5f6f92;">Code: ${escapeHtml(match.matchCode)}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(venueLine || "PlayArena venue")}</div>
            <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${escapeHtml(timeLine)}</div>
          </div>
          <div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Host and payment</div>
            <div style="margin-top:8px;font-size:14px;color:#10245e;">Host: ${escapeHtml(hostName)}${hostUser?.phone ? ` (${escapeHtml(hostUser.phone)})` : ""}</div>
            <div style="margin-top:4px;font-size:14px;color:#10245e;">${escapeHtml(paymentLine)}</div>
          </div>
          <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ error, matchId: match.id, email: ownerEmail }, "Open match owner email failed");
  }
};

const formatDateTimeForEmail = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

const getConfirmedJoinPlayOutcome = (match) => {
  if (match.result?.status !== "CONFIRMED") return null;

  const [teamA, teamB] = getOpenMatchResultTeams(match);
  if (!teamA || !teamB) return null;

  if (!match.result.confirmedWinnerTeamId) {
    return {
      [teamA.teamId]: "DRAW",
      [teamB.teamId]: "DRAW",
    };
  }

  if (match.result.confirmedWinnerTeamId === teamA.teamId) {
    return {
      [teamA.teamId]: "WIN",
      [teamB.teamId]: "LOSS",
    };
  }

  if (match.result.confirmedWinnerTeamId === teamB.teamId) {
    return {
      [teamA.teamId]: "LOSS",
      [teamB.teamId]: "WIN",
    };
  }

  return null;
};

const resolveUserByTeamMemberContact = async (transaction, { email, mobileNumber }) => {
  const normalizedEmail = normalizeTeamMemberEmail(email);
  const normalizedPhone = normalizeTeamMemberPhone(mobileNumber);

  if (!normalizedEmail && !normalizedPhone) {
    return {
      normalizedEmail,
      normalizedPhone,
      user: null,
    };
  }

  const [userByEmail, userByPhone] = await Promise.all([
    normalizedEmail
      ? transaction.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true, email: true, phone: true, firstName: true, lastName: true, isActive: true },
        })
      : Promise.resolve(null),
    normalizedPhone
      ? transaction.user.findFirst({
          where: { phone: normalizedPhone },
          select: { id: true, email: true, phone: true, firstName: true, lastName: true, isActive: true },
        })
      : Promise.resolve(null),
  ]);

  if (userByEmail && userByPhone && userByEmail.id !== userByPhone.id) {
    throw AppError.validation("Email and mobile number belong to different accounts");
  }

  const user = userByEmail ?? userByPhone ?? null;

  return {
    normalizedEmail,
    normalizedPhone,
    user: user?.isActive ? user : null,
  };
};

const validateTeamMembers = (members = []) => {
  if (members.length < 2 || members.length > 20) {
    throw AppError.validation("Team should have 2 to 20 members");
  }

  const captainCount = members.filter((member) => member.role === "CAPTAIN").length;
  const viceCaptainCount = members.filter((member) => member.role === "VICE_CAPTAIN").length;
  if (captainCount !== 1) throw AppError.validation("Select exactly one captain");
  if (viceCaptainCount > 1) throw AppError.validation("Select only one vice captain");

  const missingContacts = members.filter((member) => !normalizeTeamMemberEmail(member.email) && !normalizeTeamMemberPhone(member.mobileNumber));
  if (missingContacts.length) {
    throw AppError.validation("Every team member needs email or mobile number");
  }

  const duplicateEmails = members
    .map((member) => normalizeTeamMemberEmail(member.email))
    .filter(Boolean)
    .filter((email, index, list) => list.indexOf(email) !== index);
  if (duplicateEmails.length) {
    throw AppError.validation("Each team member email can be used only once");
  }

  const duplicatePhones = members
    .map((member) => normalizeTeamMemberPhone(member.mobileNumber))
    .filter(Boolean)
    .filter((mobileNumber, index, list) => list.indexOf(mobileNumber) !== index);
  if (duplicatePhones.length) {
    throw AppError.validation("Each team member mobile number can be used only once");
  }

  const duplicateUserIds = members
    .map((member) => member.userId)
    .filter(Boolean)
    .filter((userId, index, list) => list.indexOf(userId) !== index);
  if (duplicateUserIds.length) {
    throw AppError.validation("The same app account cannot be added twice in one team");
  }
};

export const listPublicTurfs = async ({ page, limit, search, city, sport }) => {
  const where = publicTurfWhere({ search, city, sport });
  const [items, total] = await prisma.$transaction([
    prisma.turf.findMany({
      where,
      include: { _count: { select: { slots: { where: { status: "AVAILABLE", startAt: { gt: new Date() } } } } } },
      orderBy: { approvedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.turf.count({ where }),
  ]);

  return {
    items: items.map(serializeTurf),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
};

export const getPublicTurf = async (turfId) => {
  const turf = await prisma.turf.findFirst({
    where: { id: turfId, status: "APPROVED", isActive: true },
    include: { _count: { select: { slots: { where: { status: "AVAILABLE", startAt: { gt: new Date() } } } } } },
  });
  if (!turf) throw AppError.notFound("Turf");
  return serializeTurf(turf);
};

export const listPublicSlots = async (turfId, { dateFrom, dateTo, includeUnavailable = false }) => {
  await getPublicTurf(turfId);
  const now = new Date();
  const slots = await prisma.turfSlot.findMany({
    where: {
      turfId,
      startAt: {
        gte: dateFrom ? toDateTime(dateFrom) : now,
        ...(dateTo ? { lt: toDateTime(addDays(dateTo, 1)) } : {}),
      },
      ...(includeUnavailable ? {} : { status: "AVAILABLE" }),
    },
    orderBy: { startAt: "asc" },
    take: 200,
  });
  return slots.map(serializeSlot);
};

const getBookableSlot = async (slotId) => {
  const slot = await prisma.turfSlot.findUnique({
    where: { id: slotId },
    include: { turf: true },
  });

  if (!slot || slot.turf.status !== "APPROVED" || !slot.turf.isActive) {
    throw AppError.notFound("Available slot");
  }
  if (slot.startAt <= new Date()) throw AppError.conflict("Past slots cannot be booked");
  if (slot.status !== "AVAILABLE") throw AppError.conflict("This slot is no longer available");
  return slot;
};

const createConfirmedBooking = async (transaction, { userId, slot, payment = null }) => {
  const updated = await transaction.turfSlot.updateMany({
    where: { id: slot.id, status: "AVAILABLE", startAt: { gt: new Date() } },
    data: { status: "BOOKED" },
  });

  if (updated.count !== 1) {
    throw AppError.conflict("This slot is no longer available");
  }

  return transaction.booking.create({
    data: {
      bookingCode: bookingCode(),
      userId,
      turfId: slot.turfId,
      slotId: slot.id,
      price: slot.price,
      ...(payment
        ? {
            paymentStatus: "PAID",
            paymentProvider: payment.provider,
            paymentOrderId: payment.paymentOrderId,
            paymentId: payment.paymentId,
            paymentSignature: payment.paymentSignature,
            paymentCapturedAt: payment.paymentCapturedAt,
          }
        : {}),
    },
    include: { slot: true, turf: true },
  });
};

const reserveOpenMatchCapacity = async (transaction, match, playerCount) => {
  const nextFilled = Number(match.spotsFilled ?? 0) + Number(playerCount ?? 0);
  const nextStatus = deriveOpenMatchStatus({ ...match, spotsFilled: nextFilled });
  const updated = await transaction.openMatch.updateMany({
    where: {
      id: match.id,
      status: { in: OPEN_MATCH_JOINABLE_STATUSES },
      spotsFilled: { lte: match.maxPlayers - playerCount },
    },
    data: {
      spotsFilled: { increment: playerCount },
      status: nextStatus,
    },
  });

  if (updated.count !== 1) {
    throw AppError.conflict("Not enough spots left in this match");
  }

  return nextFilled;
};

export const bookSlot = async (userId, slotId) => {
  const slot = await getBookableSlot(slotId);
  const cancellationPolicy = await getCancellationPolicyRecord();

  const booking = await prisma.$transaction(async (transaction) => {
    return createConfirmedBooking(transaction, { userId, slot });
  });

  sendDirectBookingNotifications(booking.id).catch((error) => {
    logger.error({ error, bookingId: booking.id }, "Direct booking confirmation emails failed");
  });
  const refreshedBooking = await reconcileDirectBookingPayoutAutomation(booking.id);
  return serializeBooking(refreshedBooking ?? booking, cancellationPolicy);
};

export const createBookingPaymentOrder = async (userId, slotId) => {
  const slot = await getBookableSlot(slotId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  const gateway = await getActiveBookingPaymentGatewayConfig();

  if (!gateway) {
    return {
      mode: "BOOKED",
      booking: await bookSlot(userId, slotId),
    };
  }

  const order = await createRazorpayBookingOrder({
    amount: slot.price * 100,
    receipt: bookingPaymentReceipt(),
    notes: {
      slotId: slot.id,
      turfId: slot.turfId,
      userId,
    },
    customer: user,
  });

  return {
    mode: "PAYMENT_REQUIRED",
    payment: {
      provider: order.provider,
      keyId: order.keyId,
      currency: order.currency,
      amount: order.amount,
      orderId: order.orderId,
      name: order.checkout.name,
      description: order.checkout.description,
      prefill: order.checkout.prefill,
    },
    slot: serializeSlot(slot),
  };
};

export const verifyBookingPaymentAndBookSlot = async (
  userId,
  { slotId, razorpayOrderId, razorpayPaymentId, razorpaySignature },
) => {
  const slot = await getBookableSlot(slotId);
  const payment = await verifyRazorpayPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    expectedAmount: slot.price * 100,
  });

  const existing = await prisma.booking.findFirst({
    where: {
      OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
    },
    include: { slot: true, turf: true },
  });
  if (existing) {
    if (existing.userId !== userId) {
      throw AppError.conflict("This payment has already been used for another booking");
    }
    const refreshedExisting = await reconcileDirectBookingPayoutAutomation(existing.id);
    return serializeBooking(refreshedExisting ?? existing, await getCancellationPolicyRecord());
  }

  const booking = await prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.booking.findFirst({
      where: {
        OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
      },
      include: { slot: true, turf: true },
    });
    if (duplicate) {
      if (duplicate.userId !== userId) {
        throw AppError.conflict("This payment has already been used for another booking");
      }
      return duplicate;
    }
    return createConfirmedBooking(transaction, { userId, slot, payment });
  });

  sendDirectBookingNotifications(booking.id).catch((error) => {
    logger.error({ error, bookingId: booking.id }, "Direct booking confirmation emails failed");
  });
  const refreshedBooking = await reconcileDirectBookingPayoutAutomation(booking.id);
  return serializeBooking(refreshedBooking ?? booking, await getCancellationPolicyRecord());
};

export const listUserBookings = async (userId) => {
  const cancellationPolicy = await getCancellationPolicyRecord();
  const initialBookings = await prisma.booking.findMany({
    where: { userId },
    include: {
      openMatch: true,
      slot: { include: { openMatch: true, openMatchSlots: true } },
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const directBookingIds = initialBookings
    .filter((booking) => !(booking.openMatch || booking.slot?.openMatch || booking.slot?.openMatchSlots?.length))
    .map((booking) => booking.id);

  if (directBookingIds.length) {
    await reconcileDirectBookingPayoutAutomationBatch(directBookingIds);
  }

  const bookings =
    directBookingIds.length > 0
      ? await prisma.booking.findMany({
          where: { userId },
          include: {
            openMatch: true,
            slot: { include: { openMatch: true, openMatchSlots: true } },
            turf: true,
            paymentRefunds: { orderBy: { requestedAt: "desc" } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : initialBookings;

  return bookings.map((booking) => serializeBooking(booking, cancellationPolicy));
};

export const cancelUserBooking = async (userId, bookingId) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: {
      openMatch: true,
      slot: { include: { openMatch: true, openMatchSlots: true } },
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
    },
  });
  if (!booking) throw AppError.notFound("Booking");
  if (booking.status !== "CONFIRMED") throw AppError.conflict("Only confirmed bookings can be cancelled");
  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getUserBookingCancellationPlan(booking, cancellationPolicy);
  if (!cancellationPlan.canCancel) throw AppError.conflict("This booking can no longer be cancelled");

  await prisma.$transaction(async (transaction) => {
    await transaction.turfSlot.update({
      where: { id: booking.slotId },
      data: { status: "AVAILABLE" },
    });
    await transaction.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: "Cancelled by user",
        cancelledByRole: "USER",
      },
    });
  });

  const cancelledBooking = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: {
      openMatch: true,
      slot: { include: { openMatch: true, openMatchSlots: true } },
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
    },
  });
  const refundedBooking =
    cancellationPlan.refundAmount > 0
      ? await createBookingRefund(cancelledBooking, {
          actorRole: "USER",
          reason: "Cancelled by user",
          amount: cancellationPlan.refundAmount,
        })
      : await reconcileDirectBookingPayoutAutomation(cancelledBooking.id);

  return serializeBooking(refundedBooking ?? cancelledBooking, cancellationPolicy);
};

const userTeamInclude = {
  members: { orderBy: { createdAt: "asc" } },
};

const ensureOwnedUserTeam = async (userId, teamId, transaction = prisma) => {
  const team = await transaction.userTeam.findFirst({
    where: { id: teamId, ownerUserId: userId, isActive: true },
    include: userTeamInclude,
  });
  if (!team) throw AppError.notFound("Team");
  return team;
};

const buildLinkedTeamMembers = async (transaction, ownerUserId, members = []) => {
  validateTeamMembers(members);

  const resolvedMembers = [];
  for (const member of members) {
    const { normalizedEmail: email, normalizedPhone: mobileNumber, user } = await resolveUserByTeamMemberContact(transaction, member);

    if (member.role === "CAPTAIN") {
      if (user && user.id !== ownerUserId) {
        throw AppError.validation("Captain must match your registered account");
      }
      resolvedMembers.push({
        userId: ownerUserId,
        displayName: member.displayName.trim(),
        email,
        mobileNumber,
        role: member.role,
      });
      continue;
    }

    if (!user) {
      throw AppError.validation(`${member.displayName.trim()} is not registered yet. Ask them to sign up first`);
    }

    resolvedMembers.push({
      userId: user.id,
      displayName: member.displayName.trim(),
      email,
      mobileNumber,
      role: member.role,
    });
  }

  const duplicateResolvedUserIds = resolvedMembers
    .map((member) => member.userId)
    .filter(Boolean)
    .filter((userId, index, list) => list.indexOf(userId) !== index);
  if (duplicateResolvedUserIds.length) {
    throw AppError.validation("The same app account cannot be added twice in one team");
  }

  return resolvedMembers;
};

export const getUserTeamMemberStatus = async (_userId, { email, mobileNumber }) => {
  const { normalizedEmail, normalizedPhone, user } = await resolveUserByTeamMemberContact(prisma, { email, mobileNumber });
  if (!normalizedEmail && !normalizedPhone) {
    throw AppError.validation("Enter an email or mobile number");
  }

  return {
    email: normalizedEmail ?? null,
    mobileNumber: normalizedPhone ?? null,
    isRegistered: Boolean(user),
    userId: user?.id ?? null,
    displayName: user ? getUserDisplayName(user) : null,
  };
};

export const inviteUserTeamMember = async (userId, { email, displayName, teamName }) => {
  const normalizedEmail = normalizeTeamMemberEmail(email);
  if (!normalizedEmail) {
    throw AppError.validation("Enter an email to send a registration request");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, isActive: true },
  });
  if (existingUser?.isActive) {
    throw AppError.conflict("This email is already registered");
  }

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  const inviterName = getUserDisplayName(owner);
  const inviteUrl = `${appBaseUrl.replace(/\/$/, "")}/signup?email=${encodeURIComponent(normalizedEmail)}`;
  const teammateName = displayName?.trim() || "player";
  const teamLabel = teamName?.trim() || "your team";

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject: `${inviterName} invited you to join ${teamLabel} on PlayArena`,
    text: `Hi ${teammateName},\n\n${inviterName} added you to ${teamLabel} on PlayArena.\n\nCreate your account here:\n${inviteUrl}\n\nOnce you register, your captain can verify you and add you to the team.\n\n- PlayArena`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10245e; line-height: 1.6;">
        <p style="margin:0 0 8px;">Hi ${teammateName},</p>
        <h2 style="margin:0 0 12px;">Join ${teamLabel} on PlayArena</h2>
        <p style="margin:0 0 12px;">
          <strong>${inviterName}</strong> added you to <strong>${teamLabel}</strong>.
        </p>
        <p style="margin:0 0 16px;">Create your account to get registered and be eligible for the team.</p>
        <p style="margin:0 0 18px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
            Create account
          </a>
        </p>
        <p style="margin:0 0 10px;color:#5f6f92;">If the button does not open, use this link:</p>
        <p style="margin:0;color:#1646d8;word-break:break-all;">${inviteUrl}</p>
        <p style="margin:18px 0 0;color:#5f6f92;">- PlayArena no-reply</p>
      </div>
    `,
  });

  if (emailResult?.skipped) {
    throw AppError.conflict("Invite email is not configured yet");
  }

  return {
    email: normalizedEmail,
    invited: true,
  };
};

export const listUserTeams = async (userId) => {
  const teams = await prisma.userTeam.findMany({
    where: { ownerUserId: userId, isActive: true },
    include: userTeamInclude,
    orderBy: { createdAt: "desc" },
  });
  return teams.map(serializeUserTeam);
};

export const createUserTeam = async (userId, input) => {
  const team = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.userTeam.findFirst({
      where: { ownerUserId: userId, name: input.name, isActive: true },
      select: { id: true },
    });
    if (existing) throw AppError.conflict("You already have a team with this name");

    const members = await buildLinkedTeamMembers(transaction, userId, input.members);
    const sports = (input.sports?.length ? input.sports : input.sport ? [input.sport] : []).map((value) => value.trim()).filter(Boolean);
    return transaction.userTeam.create({
      data: {
        ownerUserId: userId,
        name: input.name.trim(),
        logoUrl: input.logoUrl ?? null,
        sport: sports[0] ?? null,
        sports,
        members: {
          create: members,
        },
      },
      include: userTeamInclude,
    });
  });

  return serializeUserTeam(team);
};

export const updateUserTeam = async (userId, teamId, input) => {
  const team = await prisma.$transaction(async (transaction) => {
    const existing = await ensureOwnedUserTeam(userId, teamId, transaction);
    const conflict = await transaction.userTeam.findFirst({
      where: {
        ownerUserId: userId,
        name: input.name,
        isActive: true,
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (conflict) throw AppError.conflict("You already have a team with this name");

    const members = await buildLinkedTeamMembers(transaction, userId, input.members);
    const sports = (input.sports?.length ? input.sports : input.sport ? [input.sport] : []).map((value) => value.trim()).filter(Boolean);
    await transaction.userTeamMember.deleteMany({ where: { teamId: existing.id } });

    return transaction.userTeam.update({
      where: { id: existing.id },
      data: {
        name: input.name.trim(),
        ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
        sport: sports[0] ?? null,
        sports,
        members: {
          create: members,
        },
      },
      include: userTeamInclude,
    });
  });

  return serializeUserTeam(team);
};

export const listUserLeaders = async () => {
  const tournamentTeams = await prisma.tournamentTeam.findMany({
    where: { status: "JOINED", standing: { isNot: null } },
    include: {
      standing: true,
      tournament: { select: { id: true, title: true, sport: true, status: true } },
      owner: { select: { firstName: true, lastName: true } },
      userTeam: { include: userTeamInclude },
    },
    take: 400,
  });

  const tournamentLeadersMap = tournamentTeams.reduce((map, team) => {
    const key = team.userTeamId ?? `${team.ownerUserId}:${team.name.toLowerCase()}`;
    const existing = map.get(key) ?? {
      teamId: team.userTeamId ?? team.id,
      teamName: team.userTeam?.name ?? team.name,
      sport: team.userTeam?.sport ?? team.tournament?.sport ?? null,
      ownerName: [team.owner?.firstName, team.owner?.lastName].filter(Boolean).join(" ").trim() || "Team owner",
      tournamentsPlayed: new Set(),
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      scoreDiff: 0,
    };

    existing.tournamentsPlayed.add(team.tournamentId);
    existing.played += team.standing?.played ?? 0;
    existing.wins += team.standing?.wins ?? 0;
    existing.draws += team.standing?.draws ?? 0;
    existing.losses += team.standing?.losses ?? 0;
    existing.points += team.standing?.points ?? 0;
    existing.scoreDiff += team.standing?.scoreDiff ?? 0;
    map.set(key, existing);
    return map;
  }, new Map());

  const tournamentLeaders = [...tournamentLeadersMap.values()]
    .map((leader) => ({
      ...leader,
      tournamentsPlayed: leader.tournamentsPlayed.size,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.wins - left.wins ||
        right.scoreDiff - left.scoreDiff ||
        right.played - left.played,
    )
    .slice(0, 6);

  const joinPlayMatches = await prisma.openMatch.findMany({
    where: {
      matchType: { in: ["TEAM_VS_TEAM", "NEED_OPPONENT_TEAM"] },
    },
    include: {
      hostTeam: { include: userTeamInclude },
      result: { include: { submissions: { orderBy: { createdAt: "asc" } } } },
      participants: {
        where: { kind: "TEAM" },
        include: {
          userTeam: { include: userTeamInclude },
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
    take: 400,
  });

  const joinPlayLeadersMap = new Map();
  for (const match of joinPlayMatches) {
    if (match.hostTeam) {
      const key = `host:${match.hostTeam.id}`;
      const existing = joinPlayLeadersMap.get(key) ?? {
        teamId: match.hostTeam.id,
        teamName: match.hostTeam.name,
        sport: match.hostTeam.sport ?? match.sport,
        hosted: 0,
        joined: 0,
        readyMatches: 0,
        totalPlayers: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
      };
      existing.hosted += 1;
      existing.totalPlayers += match.teamSize ?? 0;
      if (["READY", "FULL", "COMPLETED"].includes(match.status)) existing.readyMatches += 1;
      joinPlayLeadersMap.set(key, existing);
    }

    for (const participant of match.participants) {
      const key = participant.userTeamId
        ? `team:${participant.userTeamId}`
        : `legacy:${participant.userId}:${participant.teamName?.toLowerCase() ?? "team"}`;
      const existing = joinPlayLeadersMap.get(key) ?? {
        teamId: participant.userTeamId ?? participant.id,
        teamName: participant.userTeam?.name ?? participant.teamName ?? "Team",
        sport: participant.userTeam?.sport ?? match.sport,
        hosted: 0,
        joined: 0,
        readyMatches: 0,
        totalPlayers: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
      };
      if (participant.userTeamId !== match.hostTeamId) {
        existing.joined += 1;
      }
      existing.totalPlayers += participant.playerCount ?? 0;
      if (["READY", "FULL", "COMPLETED"].includes(match.status)) existing.readyMatches += 1;
      joinPlayLeadersMap.set(key, existing);
    }

    const confirmedOutcome = getConfirmedJoinPlayOutcome(match);
    if (confirmedOutcome) {
      for (const [teamId, outcome] of Object.entries(confirmedOutcome)) {
        const leaderKey =
          teamId === match.hostTeamId
            ? `host:${teamId}`
            : `team:${teamId}`;
        const leader = joinPlayLeadersMap.get(leaderKey);
        if (!leader) continue;
        leader.played += 1;
        if (outcome === "WIN") {
          leader.wins += 1;
          leader.points += 2;
        } else if (outcome === "DRAW") {
          leader.draws += 1;
          leader.points += 1;
        } else {
          leader.losses += 1;
        }
      }
    }
  }

  const joinPlayLeaders = [...joinPlayLeadersMap.values()]
    .map((leader) => ({
      ...leader,
      activityScore: leader.points * 5 + leader.hosted * 3 + leader.joined * 2 + leader.readyMatches,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.wins - left.wins ||
        right.activityScore - left.activityScore ||
        right.readyMatches - left.readyMatches ||
        right.totalPlayers - left.totalPlayers,
    )
    .slice(0, 6);

  return {
    tournamentLeaders,
    joinPlayLeaders,
  };
};

const openMatchInclude = {
  host: true,
  hostTeam: {
    include: {
      members: { orderBy: { createdAt: "asc" } },
    },
  },
  result: {
    include: {
      submissions: { orderBy: { createdAt: "asc" } },
    },
  },
  turf: { include: { _count: { select: { slots: { where: { status: "AVAILABLE", startAt: { gt: new Date() } } } } } } },
  slot: true,
  reservedSlots: { include: { slot: true }, orderBy: { position: "asc" } },
  participants: {
    include: {
      user: true,
      userTeam: { include: { members: { orderBy: { createdAt: "asc" } } } },
      refunds: { orderBy: { requestedAt: "desc" } },
    },
    orderBy: { joinedAt: "asc" },
  },
};

const coordinatesFromQuery = ({ latitude, longitude }) => {
  if (latitude === undefined || longitude === undefined) return null;
  return { latitude: Number(latitude), longitude: Number(longitude) };
};

export const listOpenMatches = async ({ sport, city, status, latitude, longitude, radiusKm }) => {
  const now = new Date();
  const statusWhere = status ? { status } : { status: { in: OPEN_MATCH_JOINABLE_STATUSES } };
  const matches = await prisma.openMatch.findMany({
    where: {
      ...statusWhere,
      OR: [
        { sessionStartAt: { gt: now } },
        { sessionStartAt: null, slot: { startAt: { gt: now } } },
      ],
      ...(sport ? { sport: { equals: sport, mode: "insensitive" } } : {}),
      ...(city ? { turf: { city: { contains: city, mode: "insensitive" } } } : {}),
    },
    include: openMatchInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const point = coordinatesFromQuery({ latitude, longitude });
  const radius = Number(radiusKm ?? 25);
  const nearbyMatches = point
    ? matches.filter((match) =>
        Number.isFinite(match.turf?.latitude) &&
        Number.isFinite(match.turf?.longitude) &&
        distanceKm(point, { latitude: match.turf.latitude, longitude: match.turf.longitude }) <= radius,
      )
    : matches;

  queueOpenMatchAutomation(nearbyMatches.map((match) => match.id));

  return nearbyMatches
    .map(serializeOpenMatch)
    .filter((match) => status || (isOpenMatchJoinableStatus(match.status) && match.spotsLeft > 0));
};

export const listCommunityOpenMatches = async () => {
  const now = new Date();
  const matches = await prisma.openMatch.findMany({
    where: {
      OR: [
        {
          matchType: "PLAYER_JOIN",
          OR: [
            { status: "COMPLETED" },
            { sessionEndAt: { lte: now } },
            { sessionEndAt: null, slot: { endAt: { lte: now } } },
          ],
        },
        {
          matchType: { in: ["TEAM_VS_TEAM", "NEED_OPPONENT_TEAM"] },
          OR: [
            { status: "COMPLETED" },
            { sessionEndAt: { lte: now } },
            { sessionEndAt: null, slot: { endAt: { lte: now } } },
            { result: { isNot: null } },
          ],
        },
      ],
    },
    include: openMatchInclude,
    orderBy: [{ sessionEndAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  queueOpenMatchAutomation(matches.map((match) => match.id));

  return matches.map(serializeOpenMatch);
};

export const listMyOpenMatches = async (userId) => {
  const matches = await prisma.openMatch.findMany({
    where: {
      OR: [
        { hostUserId: userId },
        { participants: { some: { userId } } },
      ],
    },
    include: openMatchInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  queueOpenMatchAutomation(matches.map((match) => match.id));
  return matches.map(serializeOpenMatch);
};

const hostStartingSpots = (input, hostTeam = null) =>
  input.matchType === "PLAYER_JOIN" ? 1 : hostTeam?.members?.length ?? input.teamSize;

const validateTeamMatchRosterSize = (memberCount, label = "Team") => {
  if (memberCount < MIN_TEAM_MATCH_SIZE) {
    throw AppError.validation(`${label} must have at least ${MIN_TEAM_MATCH_SIZE} players`);
  }
  if (memberCount > MAX_TEAM_MATCH_SIZE) {
    throw AppError.validation(`${label} can have a maximum of ${MAX_TEAM_MATCH_SIZE} players`);
  }
};

const resolveSelectedTeamMemberIds = (team, selectedIds = []) => {
  if (!team) return [];
  const uniqueIds = [...new Set(selectedIds.filter(Boolean))];
  if (!uniqueIds.length) return team.members?.map((member) => member.id) ?? [];
  const validIds = new Set((team.members ?? []).map((member) => member.id));
  if (uniqueIds.some((memberId) => !validIds.has(memberId))) {
    throw AppError.validation("Selected players must belong to the saved team");
  }
  return uniqueIds;
};

const getSelectedTeamMembers = (team, selectedIds = []) => {
  const selectedIdSet = new Set(selectedIds);
  return (team?.members ?? []).filter((member) => selectedIdSet.has(member.id));
};

const assertOpenMatchPlayersAvailable = async (transaction, { matchId, selectedMembers }) => {
  const emails = [...new Set(selectedMembers.map((member) => normalizeTeamMemberEmail(member.email)).filter(Boolean))];
  const userIds = [...new Set(selectedMembers.map((member) => member.userId).filter(Boolean))];
  if (!emails.length && !userIds.length) return;

  const participants = await transaction.openMatchParticipant.findMany({
    where: { matchId, status: "PAID" },
    include: { userTeam: { include: userTeamInclude } },
  });

  for (const participant of participants) {
    const participantMemberIds = new Set(participant.selectedMemberIds ?? []);
    const participantMembers = (participant.userTeam?.members ?? []).filter((member) => participantMemberIds.has(member.id));
    const hasEmailConflict = participantMembers.some((member) => {
      const email = normalizeTeamMemberEmail(member.email);
      return email && emails.includes(email);
    });
    const hasUserConflict = participantMembers.some((member) => member.userId && userIds.includes(member.userId));
    if (hasEmailConflict || hasUserConflict) {
      throw AppError.conflict("One selected player is already in this match");
    }
  }
};

const selectedSlotIdsFromInput = (input) => {
  if (Array.isArray(input.slotIds) && input.slotIds.length > 0) {
    return [...new Set(input.slotIds)];
  }
  return input.slotId ? [input.slotId] : [];
};

const matchFeesFromSlotValue = (slotPrice, input) => {
  if (input.matchType === "PLAYER_JOIN") {
    return {
      entryFeePerPlayer: Math.ceil(slotPrice / input.maxPlayers),
      teamEntryFee: null,
    };
  }

  return {
    entryFeePerPlayer: Math.ceil(slotPrice / input.maxPlayers),
    teamEntryFee: Math.ceil(slotPrice / 2),
  };
};

const hostOpenMatchPaymentAmountFromFees = (input, fees, startingSpots) => {
  if (input.matchType === "PLAYER_JOIN") {
    return fees.entryFeePerPlayer * startingSpots;
  }

  return fees.teamEntryFee ?? fees.entryFeePerPlayer * startingSpots;
};

const sortSlotsForSession = (slots) =>
  [...slots].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());

const validateContiguousSlots = (slots) => {
  for (let index = 1; index < slots.length; index += 1) {
    const previousEnd = new Date(slots[index - 1].endAt).getTime();
    const currentStart = new Date(slots[index].startAt).getTime();
    if (previousEnd !== currentStart) {
      throw AppError.validation("Select continuous slots only for one hosted match");
    }
  }
};

const getCheckoutCustomer = async (userId) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });

const prepareOpenMatchHosting = async (userId, input) => {
  const slotIds = selectedSlotIdsFromInput(input);
  if (slotIds.length === 0) throw AppError.validation("Select at least one slot");

  const hostTeam =
    input.matchType !== "PLAYER_JOIN" && input.hostTeamId
      ? await ensureOwnedUserTeam(userId, input.hostTeamId)
      : null;

  const slots = await prisma.turfSlot.findMany({
    where: { id: { in: slotIds } },
    include: { turf: true },
  });
  if (slots.length !== slotIds.length) throw AppError.notFound("Available slot");

  const turfId = slots[0].turfId;
  if (slots.some((slot) => slot.turfId !== turfId)) throw AppError.validation("Select slots from the same venue");
  if (slots.some((slot) => slot.turf.status !== "APPROVED" || !slot.turf.isActive)) throw AppError.notFound("Available slot");

  const orderedSlots = sortSlotsForSession(slots);
  orderedSlots.forEach((slot) => {
    if (slot.startAt <= new Date()) throw AppError.conflict("Past matches cannot be hosted");
    if (slot.status !== "AVAILABLE") throw AppError.conflict("This slot is no longer available");
    if (!slot.turf.sports.some((sport) => sport.toLowerCase() === input.sport.toLowerCase())) {
      throw AppError.validation("Sport must be available at this venue");
    }
  });
  validateContiguousSlots(orderedSlots);

  const hostMemberIds = input.matchType === "PLAYER_JOIN" ? [] : resolveSelectedTeamMemberIds(hostTeam, input.hostMemberIds);
  const resolvedTeamSize = input.matchType === "PLAYER_JOIN" ? input.maxPlayers : hostMemberIds.length;
  const resolvedMinPlayers =
    input.matchType === "PLAYER_JOIN"
      ? Math.min(Math.max(Number(input.minPlayers ?? Math.min(8, input.maxPlayers)), 2), input.maxPlayers)
      : input.maxPlayers;
  const startingSpots = input.matchType === "PLAYER_JOIN" ? hostStartingSpots(input, hostTeam) : resolvedTeamSize;
  if (input.matchType !== "PLAYER_JOIN") {
    if (!hostTeam) throw AppError.validation("Choose a saved team first");
    validateTeamMatchRosterSize(resolvedTeamSize, "Host team");
  }
  if (input.matchType === "PLAYER_JOIN" && resolvedMinPlayers > input.maxPlayers) {
    throw AppError.validation("Minimum players cannot be more than total players");
  }
  if (startingSpots > input.maxPlayers) throw AppError.validation("Max players must include the host side");
  if (input.matchType !== "PLAYER_JOIN" && input.maxPlayers < resolvedTeamSize * 2) {
    throw AppError.validation("Team matches must allow both teams to play");
  }

  const totalSlotPrice = orderedSlots.reduce((sum, slot) => sum + slot.price, 0);
  const fees = matchFeesFromSlotValue(totalSlotPrice, input);
  const hostPaymentAmount = hostOpenMatchPaymentAmountFromFees(input, fees, startingSpots);

  return {
    hostTeam,
    hostMemberIds,
    orderedSlots,
    resolvedTeamSize,
    resolvedMinPlayers,
    startingSpots,
    totalSlotPrice,
    fees,
    hostPaymentAmount,
  };
};

const createOpenMatchForSession = async (transaction, userId, input, prepared, payment = null) => {
  const { hostTeam, hostMemberIds, orderedSlots, resolvedTeamSize, resolvedMinPlayers, startingSpots, totalSlotPrice, fees, hostPaymentAmount } = prepared;
  const slotIds = orderedSlots.map((slot) => slot.id);

  const updated = await transaction.turfSlot.updateMany({
    where: { id: { in: slotIds }, status: "AVAILABLE", startAt: { gt: new Date() } },
    data: { status: "BOOKED" },
  });
  if (updated.count !== orderedSlots.length) throw AppError.conflict("One or more selected slots are no longer available");

  const bookings = [];
  for (const slot of orderedSlots) {
    bookings.push(
      await transaction.booking.create({
        data: {
          bookingCode: bookingCode(),
          userId,
          turfId: slot.turfId,
          slotId: slot.id,
          price: slot.price,
        },
      }),
    );
  }

  const primarySlot = orderedSlots[0];
  const primaryBooking = bookings[0];
  const sessionStartAt = primarySlot.startAt;
  const sessionEndAt = orderedSlots[orderedSlots.length - 1].endAt;

  const created = await transaction.openMatch.create({
    data: {
      matchCode: matchCode(),
      hostUserId: userId,
      hostTeamId: hostTeam?.id ?? null,
      turfId: primarySlot.turfId,
      slotId: primarySlot.id,
      bookingId: primaryBooking.id,
      title: input.title || `${input.sport} open match`,
      sport: input.sport,
      matchType: input.matchType,
      status: deriveOpenMatchStatus({ spotsFilled: startingSpots, minPlayers: resolvedMinPlayers, maxPlayers: input.maxPlayers, sessionStartAt }),
      teamSize: resolvedTeamSize,
      minPlayers: resolvedMinPlayers,
      maxPlayers: input.maxPlayers,
      spotsFilled: startingSpots,
      entryFeePerPlayer: fees.entryFeePerPlayer,
      teamEntryFee: fees.teamEntryFee,
      sessionStartAt,
      sessionEndAt,
      totalSlotPrice,
      reservedSlotCount: orderedSlots.length,
      reservedSlots: {
        create: orderedSlots.map((slot, index) => ({
          slotId: slot.id,
          position: index,
        })),
      },
      participants: {
        create: {
          userId,
          kind: input.matchType === "PLAYER_JOIN" ? "PLAYER" : "TEAM",
          userTeamId: input.matchType === "PLAYER_JOIN" ? null : hostTeam?.id ?? null,
          teamName: input.matchType === "PLAYER_JOIN" ? null : hostTeam?.name ?? "Host Team",
          playerCount: startingSpots,
          selectedMemberIds: input.matchType === "PLAYER_JOIN" ? [] : hostMemberIds,
          amountPaid: hostPaymentAmount,
          ...(payment
            ? {
                paymentProvider: payment.provider,
                paymentOrderId: payment.paymentOrderId,
                paymentId: payment.paymentId,
                paymentSignature: payment.paymentSignature,
                paymentCapturedAt: payment.paymentCapturedAt,
              }
            : {}),
        },
      },
    },
  });

  return transaction.openMatch.findUnique({ where: { id: created.id }, include: openMatchInclude });
};

export const createOpenMatch = async (userId, input) => {
  const prepared = await prepareOpenMatchHosting(userId, input);

  const match = await prisma.$transaction((transaction) =>
    createOpenMatchForSession(transaction, userId, input, prepared),
  );
  const serializedMatch = serializeOpenMatch(match);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });

  notifyNearbyUsersForOpenMatch(serializedMatch.id)
    .then((result) => logger.info({ matchId: serializedMatch.id, ...result }, "Nearby open match notifications processed"))
    .catch((error) => logger.error({ error, matchId: serializedMatch.id }, "Nearby open match notifications failed"));
  sendOpenMatchUserEmail({
    user,
    match: serializedMatch,
    subject: `Your host match is live on PlayArena: ${serializedMatch.title}`,
    heading: "Your host match is now live",
    intro: "Your Join & Play host match has been created successfully. Players can start joining now.",
    paymentSummary: null,
  });
  sendOpenMatchOwnerEmail({
    match: serializedMatch,
    hostUser: user,
    paymentSummary: null,
  });
  queueOpenMatchAutomation([serializedMatch.id]);

  return serializedMatch;
};

export const createOpenMatchPaymentOrder = async (userId, input) => {
  const prepared = await prepareOpenMatchHosting(userId, input);
  if (prepared.hostPaymentAmount <= 0) {
    return {
      mode: "MATCH_CREATED",
      match: await createOpenMatch(userId, input),
    };
  }

  const gateway = await getActiveBookingPaymentGatewayConfig();
  if (!gateway) {
    return {
      mode: "MATCH_CREATED",
      match: await createOpenMatch(userId, input),
    };
  }

  const customer = await getCheckoutCustomer(userId);
  const order = await createRazorpayOrder({
    amount: prepared.hostPaymentAmount * 100,
    receipt: openMatchPaymentReceipt(),
    notes: {
      flow: "open_match_host",
      userId,
      turfId: prepared.orderedSlots[0]?.turfId ?? "",
      slotIds: prepared.orderedSlots.map((slot) => slot.id).join(","),
    },
    customer,
    description: "Open match hosting payment",
  });

  return {
    mode: "PAYMENT_REQUIRED",
    payment: {
      provider: order.provider,
      keyId: order.keyId,
      currency: order.currency,
      amount: order.amount,
      orderId: order.orderId,
      name: order.checkout.name,
      description: order.checkout.description,
      prefill: order.checkout.prefill,
    },
    pricing: {
      hostPaysNow: prepared.hostPaymentAmount,
      totalSlotPrice: prepared.totalSlotPrice,
      remainingAmount: Math.max(0, prepared.totalSlotPrice - prepared.hostPaymentAmount),
      minPlayers: prepared.resolvedMinPlayers,
      maxPlayers: input.maxPlayers,
      entryFeePerPlayer: prepared.fees.entryFeePerPlayer,
      teamEntryFee: prepared.fees.teamEntryFee,
      reservedSlotCount: prepared.orderedSlots.length,
    },
  };
};

export const verifyOpenMatchPaymentAndCreate = async (
  userId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature, ...input },
) => {
  const payment = await verifyRazorpayPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });

  const existingParticipant = await prisma.openMatchParticipant.findFirst({
    where: {
      OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
    },
    include: { match: { include: openMatchInclude } },
  });
  if (existingParticipant) {
    if (existingParticipant.userId !== userId) {
      throw AppError.conflict("This payment has already been used for another hosted match");
    }
    return serializeOpenMatch(existingParticipant.match);
  }

  const prepared = await prepareOpenMatchHosting(userId, input);
  const match = await prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.openMatchParticipant.findFirst({
      where: {
        OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
      },
      include: { match: { include: openMatchInclude } },
    });
    if (duplicate) {
      if (duplicate.userId !== userId) {
        throw AppError.conflict("This payment has already been used for another hosted match");
      }
      return duplicate.match;
    }

    return createOpenMatchForSession(transaction, userId, input, prepared, payment);
  });

  const serializedMatch = serializeOpenMatch(match);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  notifyNearbyUsersForOpenMatch(serializedMatch.id)
    .then((result) => logger.info({ matchId: serializedMatch.id, ...result }, "Nearby open match notifications processed"))
    .catch((error) => logger.error({ error, matchId: serializedMatch.id }, "Nearby open match notifications failed"));
  sendOpenMatchUserEmail({
    user,
    match: serializedMatch,
    subject: `Your host match is live on PlayArena: ${serializedMatch.title}`,
    heading: "Your host match is now live",
    intro: "Your Join & Play host match has been created successfully. Players can start joining now.",
    paymentSummary: {
      amount: prepared.hostPaymentAmount,
      paymentId: payment.paymentId,
      paymentOrderId: payment.paymentOrderId,
    },
  });
  sendOpenMatchOwnerEmail({
    match: serializedMatch,
    hostUser: user,
    paymentSummary: {
      amount: prepared.hostPaymentAmount,
      paymentId: payment.paymentId,
      paymentOrderId: payment.paymentOrderId,
    },
  });
  queueOpenMatchAutomation([serializedMatch.id]);

  return serializedMatch;
};

const prepareOpenMatchJoin = async (userId, matchId, input) => {
  const match = await prisma.openMatch.findUnique({
    where: { id: matchId },
    include: { slot: true },
  });
  if (!match) throw AppError.notFound("Open match");
  if (match.hostUserId === userId) throw AppError.conflict("Host is already in this match");
  const effectiveStatus = deriveOpenMatchStatus(match);
  if (!isOpenMatchJoinableStatus(effectiveStatus)) throw AppError.conflict("This match is not open for joining");
  if (effectiveStatus !== match.status) {
    await prisma.openMatch.update({ where: { id: match.id }, data: { status: effectiveStatus } });
    match.status = effectiveStatus;
  }
  if ((match.sessionEndAt ?? match.slot.endAt) <= new Date()) throw AppError.conflict("Past matches cannot be joined");

  const isTeamJoin = input.participantKind === "TEAM";
  if (isTeamJoin && match.matchType === "PLAYER_JOIN") throw AppError.validation("This match accepts player joins only");
  if (!isTeamJoin && match.matchType !== "PLAYER_JOIN") throw AppError.validation("This match accepts team joins only");

  const existingParticipant = await prisma.openMatchParticipant.findFirst({
    where: { matchId: match.id, userId },
  });
  if (existingParticipant?.status === "PAID") {
    throw AppError.conflict("You have already joined this match");
  }

  const linkedTeam = isTeamJoin && input.userTeamId ? await ensureOwnedUserTeam(userId, input.userTeamId) : null;
  const selectedMemberIds = isTeamJoin ? resolveSelectedTeamMemberIds(linkedTeam, input.memberIds) : [];
  const selectedMembers = isTeamJoin ? getSelectedTeamMembers(linkedTeam, selectedMemberIds) : [];
  const playerCount = isTeamJoin ? selectedMemberIds.length || (input.playerCount ?? match.teamSize) : 1;
  if (playerCount < 1) throw AppError.validation("Player count is required");
  if (isTeamJoin) {
    validateTeamMatchRosterSize(playerCount, "Selected team");
    if (playerCount !== match.teamSize) {
      throw AppError.validation(`Choose a team with exactly ${match.teamSize} players`);
    }
    await assertOpenMatchPlayersAvailable(prisma, { matchId: match.id, selectedMembers });
  }
  if (match.spotsFilled + playerCount > match.maxPlayers) throw AppError.conflict("Not enough spots left in this match");
  if (isTeamJoin && !linkedTeam && !input.teamName) throw AppError.validation("Team name is required");

  const amountPaid = isTeamJoin
    ? match.teamEntryFee ?? match.entryFeePerPlayer * playerCount
    : match.entryFeePerPlayer;

  return {
    match,
    existingParticipant,
    isTeamJoin,
    linkedTeam,
    selectedMemberIds,
    playerCount,
    amountPaid,
  };
};

const joinOpenMatchWithPrepared = async (transaction, userId, prepared, input, payment = null) => {
  const { match, existingParticipant, isTeamJoin, linkedTeam, selectedMemberIds, playerCount, amountPaid } = prepared;

  await reserveOpenMatchCapacity(transaction, match, playerCount);

  try {
    if (existingParticipant) {
      await transaction.openMatchParticipant.update({
        where: { id: existingParticipant.id },
        data: {
          kind: isTeamJoin ? "TEAM" : "PLAYER",
          status: "PAID",
          userTeamId: isTeamJoin ? linkedTeam?.id ?? null : null,
          teamName: isTeamJoin ? linkedTeam?.name ?? input.teamName : null,
          playerCount,
          selectedMemberIds,
          amountPaid,
          refundStatus: null,
          refundedAt: null,
          refundFailureReason: null,
          cancelledAt: null,
          ...(payment
            ? {
                paymentProvider: payment.provider,
                paymentOrderId: payment.paymentOrderId,
                paymentId: payment.paymentId,
                paymentSignature: payment.paymentSignature,
                paymentCapturedAt: payment.paymentCapturedAt,
              }
            : {}),
        },
      });
    } else {
      await transaction.openMatchParticipant.create({
        data: {
          matchId: match.id,
          userId,
          kind: isTeamJoin ? "TEAM" : "PLAYER",
          userTeamId: isTeamJoin ? linkedTeam?.id ?? null : null,
          teamName: isTeamJoin ? linkedTeam?.name ?? input.teamName : null,
          playerCount,
          selectedMemberIds,
          amountPaid,
          ...(payment
            ? {
                paymentProvider: payment.provider,
                paymentOrderId: payment.paymentOrderId,
                paymentId: payment.paymentId,
                paymentSignature: payment.paymentSignature,
                paymentCapturedAt: payment.paymentCapturedAt,
              }
            : {}),
        },
      });
    }
  } catch (error) {
    if (error?.code === "P2002") {
      throw AppError.conflict("You have already joined this match");
    }
    throw error;
  }

  return transaction.openMatch.findUnique({ where: { id: match.id }, include: openMatchInclude });
};

export const cancelMyOpenMatch = async (userId, matchId) => {
  const match = await prisma.openMatch.findUnique({
    where: { id: matchId },
    include: openMatchInclude,
  });
  if (!match) throw AppError.notFound("Open match");

  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = resolveCancellationPlan({
    policy: cancellationPolicy,
    turf: match.turf ?? null,
    kind: "OPEN_MATCH",
    startAt: match.sessionStartAt ?? match.slot?.startAt ?? null,
    amount: Number(match.teamEntryFee ?? match.entryFeePerPlayer ?? 0),
  });
  const effectiveStatus = deriveOpenMatchStatus(match);
  if (!cancellationPlan.canCancel || ["CANCELLED", "CANCELLED_REFUND", "COMPLETED"].includes(effectiveStatus)) {
    throw AppError.conflict("This host match can no longer be cancelled");
  }

  const { forceOpenMatchRefunds, refundOpenMatchParticipant, reconcileOpenMatchAutomation } = await import("./open-match-automation.service.js");

  if (match.hostUserId === userId) {
    const hasPaidParticipants = (match.participants ?? []).some((participant) => Number(participant.amountPaid ?? 0) > 0 && participant.status === "PAID");
    const nextStatus = hasPaidParticipants && cancellationPlan.refundPercent > 0 ? "CANCELLED_REFUND" : "CANCELLED";
    const slotIds = [...new Set((match.reservedSlots ?? []).map((reservedSlot) => reservedSlot.slotId).filter(Boolean))];

    await prisma.$transaction(async (transaction) => {
      if (slotIds.length) {
        await transaction.booking.updateMany({
          where: {
            slotId: { in: slotIds },
            status: "CONFIRMED",
          },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });

        await transaction.turfSlot.updateMany({
          where: { id: { in: slotIds } },
          data: { status: "AVAILABLE" },
        });
      }

      await transaction.openMatchParticipant.updateMany({
        where: {
          matchId: match.id,
          status: "PAID",
        },
        data: {
          cancelledAt: new Date(),
          ...(cancellationPlan.refundPercent > 0 ? {} : { status: "CANCELLED" }),
        },
      });

      await transaction.openMatch.update({
        where: { id: match.id },
        data: {
          status: nextStatus,
          payoutStatus: hasPaidParticipants && cancellationPlan.refundPercent > 0 ? "REFUND_REQUIRED" : "CANCELLED",
          offlineCollectionNote: [match.offlineCollectionNote, "Cancelled by host user"].filter(Boolean).join(" | "),
        },
      });
    });

    if (hasPaidParticipants && cancellationPlan.refundPercent > 0) {
      await forceOpenMatchRefunds(match.id, cancellationPlan.refundPercent);
    }

    const refreshedMatch = await prisma.openMatch.findUnique({
      where: { id: match.id },
      include: openMatchInclude,
    });
    queueOpenMatchAutomation([match.id]);
    return serializeOpenMatch(refreshedMatch);
  }

  const participant = (match.participants ?? []).find((item) => item.userId === userId && item.status === "PAID");
  if (!participant) {
    throw AppError.conflict("You do not have an active paid spot in this host match");
  }

  const nextSpotsFilled = Math.max(0, Number(match.spotsFilled ?? 0) - Number(participant.playerCount ?? 0));
  const nextStatus = deriveOpenMatchStatus({ ...match, spotsFilled: nextSpotsFilled, status: "FILLING" });

  await prisma.$transaction(async (transaction) => {
    await transaction.openMatchParticipant.update({
      where: { id: participant.id },
      data: {
        cancelledAt: new Date(),
        ...(cancellationPlan.refundPercent > 0 ? {} : { status: "CANCELLED" }),
      },
    });

    await transaction.openMatch.update({
      where: { id: match.id },
      data: {
        spotsFilled: nextSpotsFilled,
        status: nextStatus,
      },
    });
  });

  if (cancellationPlan.refundPercent > 0) {
    await refundOpenMatchParticipant(match.id, participant.id, cancellationPlan.refundPercent);
  }

  await reconcileOpenMatchAutomation(match.id);
  const refreshedMatch = await prisma.openMatch.findUnique({
    where: { id: match.id },
    include: openMatchInclude,
  });
  queueOpenMatchAutomation([match.id]);
  return serializeOpenMatch(refreshedMatch);
};

export const joinOpenMatch = async (userId, matchId, input) => {
  const prepared = await prepareOpenMatchJoin(userId, matchId, input);
  const updated = await prisma.$transaction(async (transaction) =>
    joinOpenMatchWithPrepared(transaction, userId, prepared, input),
  );
  const serializedMatch = serializeOpenMatch(updated);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  sendOpenMatchUserEmail({
    user,
    match: serializedMatch,
    subject: `You joined ${serializedMatch.title} on PlayArena`,
    heading: "Your Join & Play spot is confirmed",
    intro: "You have successfully joined this host match on PlayArena.",
    paymentSummary: null,
  });
  queueOpenMatchAutomation([serializedMatch.id]);
  return serializedMatch;
};

export const createOpenMatchJoinPaymentOrder = async (userId, matchId, input) => {
  const prepared = await prepareOpenMatchJoin(userId, matchId, input);
  if (prepared.amountPaid <= 0) {
    return {
      mode: "JOINED",
      match: await joinOpenMatch(userId, matchId, input),
    };
  }

  const gateway = await getActiveBookingPaymentGatewayConfig();
  if (!gateway) {
    return {
      mode: "JOINED",
      match: await joinOpenMatch(userId, matchId, input),
    };
  }

  const customer = await getCheckoutCustomer(userId);
  const order = await createRazorpayOrder({
    amount: prepared.amountPaid * 100,
    receipt: openMatchPaymentReceipt(),
    notes: {
      flow: "open_match_join",
      userId,
      matchId,
      participantKind: prepared.isTeamJoin ? "TEAM" : "PLAYER",
    },
    customer,
    description: "Open match join payment",
  });

  return {
    mode: "PAYMENT_REQUIRED",
    payment: {
      provider: order.provider,
      keyId: order.keyId,
      currency: order.currency,
      amount: order.amount,
      orderId: order.orderId,
      name: order.checkout.name,
      description: order.checkout.description,
      prefill: order.checkout.prefill,
    },
    pricing: {
      joinAmount: prepared.amountPaid,
      playerCount: prepared.playerCount,
    },
  };
};

export const verifyOpenMatchJoinPayment = async (
  userId,
  matchId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature, ...input },
) => {
  const prepared = await prepareOpenMatchJoin(userId, matchId, input);
  const payment = await verifyRazorpayPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    expectedAmount: prepared.amountPaid * 100,
  });

  const existingParticipant = await prisma.openMatchParticipant.findFirst({
    where: {
      OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
    },
    include: { match: { include: openMatchInclude } },
  });
  if (existingParticipant) {
    if (existingParticipant.userId !== userId) {
      throw AppError.conflict("This payment has already been used for another open match join");
    }
    return serializeOpenMatch(existingParticipant.match);
  }

  const updated = await prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.openMatchParticipant.findFirst({
      where: {
        OR: [{ paymentOrderId: razorpayOrderId }, { paymentId: razorpayPaymentId }],
      },
      include: { match: { include: openMatchInclude } },
    });
    if (duplicate) {
      if (duplicate.userId !== userId) {
        throw AppError.conflict("This payment has already been used for another open match join");
      }
      return duplicate.match;
    }

    return joinOpenMatchWithPrepared(transaction, userId, prepared, input, payment);
  });

  const serializedMatch = serializeOpenMatch(updated);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  sendOpenMatchUserEmail({
    user,
    match: serializedMatch,
    subject: `You joined ${serializedMatch.title} on PlayArena`,
    heading: "Your Join & Play spot is confirmed",
    intro: "You have successfully joined this host match on PlayArena.",
    paymentSummary: {
      amount: prepared.amountPaid,
      paymentId: payment.paymentId,
      paymentOrderId: payment.paymentOrderId,
    },
  });
  queueOpenMatchAutomation([serializedMatch.id]);
  return serializedMatch;
};

const getCaptainSubmissionStatus = (match, teamId) =>
  teamId === match.hostTeamId ? "CAPTAIN_A_SUBMITTED" : "CAPTAIN_B_SUBMITTED";

const resolveConfirmedResult = (teamAOutcome, teamBOutcome, teamAId, teamBId) => {
  if (teamAOutcome === "DRAW" && teamBOutcome === "DRAW") {
    return { confirmed: true, winnerTeamId: null };
  }

  if (teamAOutcome === "WIN" && teamBOutcome === "LOSS") {
    return { confirmed: true, winnerTeamId: teamAId };
  }

  if (teamAOutcome === "LOSS" && teamBOutcome === "WIN") {
    return { confirmed: true, winnerTeamId: teamBId };
  }

  return { confirmed: false, winnerTeamId: null };
};

export const __testing = {
  createConfirmedBooking,
  createOpenMatchForSession,
  hostOpenMatchPaymentAmountFromFees,
  joinOpenMatchWithPrepared,
  matchFeesFromSlotValue,
  reserveOpenMatchCapacity,
  serializeOpenMatchFinancials,
};

export const submitOpenMatchResult = async (userId, matchId, input) => {
  const match = await prisma.openMatch.findUnique({
    where: { id: matchId },
    include: openMatchInclude,
  });

  if (!match) throw AppError.notFound("Open match");
  if (!isTeamBasedOpenMatch(match)) throw AppError.validation("Only team matches support captain result confirmation");
  if (!hasOpenMatchEnded(match)) throw AppError.conflict("You can submit the result only after the match ends");
  if (match.status === "CANCELLED") throw AppError.conflict("Cancelled matches cannot accept results");

  const [teamA, teamB] = getOpenMatchResultTeams(match);
  if (!teamA || !teamB) {
    throw AppError.validation("This match needs exactly two registered teams before result confirmation");
  }

  const captainTeam = [teamA, teamB].find((team) => team.captainUserId === userId);
  if (!captainTeam) {
    throw AppError.conflict("Only the participating captains can submit this result");
  }

  const otherTeam = captainTeam.teamId === teamA.teamId ? teamB : teamA;
  if (!captainTeam.captainUserId || !otherTeam.captainUserId) {
    throw AppError.validation("Both teams need a registered captain before result confirmation");
  }

  if (match.result?.status === "CONFIRMED") {
    throw AppError.conflict("This match result is already confirmed");
  }
  if (match.result?.status === "DISPUTED") {
    throw AppError.conflict("This match result is disputed and needs admin or host resolution");
  }

  const updatedMatch = await prisma.$transaction(async (transaction) => {
    let resultRecord = match.result;

    if (!resultRecord) {
      resultRecord = await transaction.openMatchResult.create({
        data: {
          matchId: match.id,
          status: "PENDING_RESULT",
        },
        include: {
          submissions: { orderBy: { createdAt: "asc" } },
        },
      });
    }

    await transaction.openMatchResultSubmission.upsert({
      where: {
        resultId_teamId: {
          resultId: resultRecord.id,
          teamId: captainTeam.teamId,
        },
      },
      create: {
        resultId: resultRecord.id,
        teamId: captainTeam.teamId,
        captainUserId: userId,
        outcome: input.outcome,
        note: input.note?.trim() || null,
      },
      update: {
        captainUserId: userId,
        outcome: input.outcome,
        note: input.note?.trim() || null,
      },
    });

    const submissions = await transaction.openMatchResultSubmission.findMany({
      where: { resultId: resultRecord.id },
      orderBy: { createdAt: "asc" },
    });

    const teamASubmission = submissions.find((submission) => submission.teamId === teamA.teamId) ?? null;
    const teamBSubmission = submissions.find((submission) => submission.teamId === teamB.teamId) ?? null;

    let nextStatus = getCaptainSubmissionStatus(match, captainTeam.teamId);
    let confirmedWinnerTeamId = null;
    let confirmedAt = null;
    let disputedAt = null;

    if (teamASubmission && teamBSubmission) {
      const resolution = resolveConfirmedResult(
        teamASubmission.outcome,
        teamBSubmission.outcome,
        teamA.teamId,
        teamB.teamId,
      );

      if (resolution.confirmed) {
        nextStatus = "CONFIRMED";
        confirmedWinnerTeamId = resolution.winnerTeamId;
        confirmedAt = new Date();
      } else {
        nextStatus = "DISPUTED";
        disputedAt = new Date();
      }
    }

    await transaction.openMatchResult.update({
      where: { id: resultRecord.id },
      data: {
        status: nextStatus,
        confirmedWinnerTeamId,
        lastSubmittedByTeamId: captainTeam.teamId,
        confirmedAt,
        disputedAt,
      },
    });

    await transaction.openMatch.update({
      where: { id: match.id },
      data: {
        status: match.status === "CANCELLED" ? match.status : "COMPLETED",
      },
    });

    return transaction.openMatch.findUnique({
      where: { id: match.id },
      include: openMatchInclude,
    });
  });

  const serializedMatch = serializeOpenMatch(updatedMatch);
  queueOpenMatchAutomation([serializedMatch.id]);
  return serializedMatch;
};
