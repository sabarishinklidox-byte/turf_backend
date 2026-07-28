  import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";
import { forceOpenMatchRefunds, reconcileOpenMatchAutomation, triggerOpenMatchPayoutRelease } from "./open-match-automation.service.js";
import { getCancellationPolicyRecord, resolveCancellationPlan } from "./cancellation-policy.service.js";
import { deriveOpenMatchStatus, serializeOpenMatchFinancials } from "./user.service.js";

const serializeUser = (user) =>
  user
    ? {
        id: user.id,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
        email: user.email,
        phone: user.phone,
      }
    : null;

const paymentMatchInclude = {
  host: true,
  hostTeam: true,
  turf: true,
  slot: true,
  booking: true,
  reservedSlots: {
    include: {
      slot: true,
    },
    orderBy: { position: "asc" },
  },
  result: {
    include: {
      submissions: true,
    },
  },
  participants: {
    include: {
      user: true,
      userTeam: true,
      refunds: {
        orderBy: { requestedAt: "desc" },
      },
    },
    orderBy: { joinedAt: "asc" },
  },
  payoutRelease: true,
};

const serializeOpenMatchRefund = (refund) => ({
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
});

const serializeOpenMatchPaymentParticipant = (participant) => ({
  id: participant.id,
  kind: participant.kind,
  status: participant.status,
  teamName: participant.teamName,
  playerCount: participant.playerCount,
  selectedMemberIds: participant.selectedMemberIds ?? [],
  amountPaid: participant.amountPaid,
  paymentProvider: participant.paymentProvider,
  paymentOrderId: participant.paymentOrderId,
  paymentId: participant.paymentId,
  paymentCapturedAt: participant.paymentCapturedAt,
  joinedAt: participant.joinedAt,
  refundStatus: participant.refundStatus ?? null,
  refundedAt: participant.refundedAt ?? null,
  refundFailureReason: participant.refundFailureReason ?? null,
  user: serializeUser(participant.user),
  userTeam: participant.userTeam
    ? {
        id: participant.userTeam.id,
        name: participant.userTeam.name,
        logoUrl: participant.userTeam.logoUrl ?? null,
      }
    : null,
  refunds: (participant.refunds ?? []).map(serializeOpenMatchRefund),
});

const serializeOpenMatchPayoutRelease = (payoutRelease) =>
  payoutRelease
    ? {
        id: payoutRelease.id,
        amount: payoutRelease.amount,
        currency: payoutRelease.currency,
        payoutMethod: payoutRelease.payoutMethod,
        referenceId: payoutRelease.referenceId,
        status: payoutRelease.status,
        razorpayContactId: payoutRelease.razorpayContactId ?? null,
        razorpayFundAccountId: payoutRelease.razorpayFundAccountId ?? null,
        razorpayPayoutId: payoutRelease.razorpayPayoutId ?? null,
        failureReason: payoutRelease.failureReason ?? null,
        utr: payoutRelease.utr ?? null,
        requestedAt: payoutRelease.requestedAt,
        processedAt: payoutRelease.processedAt ?? null,
        failedAt: payoutRelease.failedAt ?? null,
        reversedAt: payoutRelease.reversedAt ?? null,
      }
    : null;

const serializeOpenMatchPayment = (match) => ({
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
  entryFeePerPlayer: match.entryFeePerPlayer,
  teamEntryFee: match.teamEntryFee,
  sessionStartAt: match.sessionStartAt,
  sessionEndAt: match.sessionEndAt,
  createdAt: match.createdAt,
  canCancelMatch: Boolean(match?.cancellationPolicy?.canCancel) &&
    !["CANCELLED", "CANCELLED_REFUND", "COMPLETED"].includes(deriveOpenMatchStatus(match)),
  cancellationPolicy: match?.cancellationPolicy
    ? {
        canCancel: match.cancellationPolicy.canCancel,
        refundPercent: match.cancellationPolicy.refundPercent,
        refundAmount: match.cancellationPolicy.refundAmount,
        remainingHours: match.cancellationPolicy.remainingHours,
        tier: match.cancellationPolicy.tier,
        fullRefundHours: match.cancellationPolicy.policyWindow?.fullRefundHours ?? null,
        partialRefundHours: match.cancellationPolicy.policyWindow?.partialRefundHours ?? null,
        noRefundHours: match.cancellationPolicy.policyWindow?.noRefundHours ?? null,
        source: match.cancellationPolicy.source ?? "MASTER",
      }
    : null,
  host: serializeUser(match.host),
  hostTeam: match.hostTeam
    ? {
        id: match.hostTeam.id,
        name: match.hostTeam.name,
        logoUrl: match.hostTeam.logoUrl ?? null,
      }
    : null,
  turf: match.turf
    ? {
        id: match.turf.id,
        turfName: match.turf.name,
        city: match.turf.city,
        ownerName: match.turf.ownerName,
        payoutMethod: match.turf.payoutMethod ?? null,
        cancellationPolicy: {
          source: match.cancellationPolicy?.source ?? "MASTER",
          overrideEnabled: Boolean(match.turf.openMatchCancellationOverrideEnabled),
          fullRefundHours: match.turf.openMatchCancellationFullRefundHours ?? null,
          partialRefundHours: match.turf.openMatchCancellationPartialRefundHours ?? null,
          partialRefundPercent: match.turf.openMatchCancellationPartialRefundPercent ?? null,
          noRefundHours: match.turf.openMatchCancellationNoRefundHours ?? null,
        },
      }
    : null,
  booking: match.booking
    ? {
        id: match.booking.id,
        bookingCode: match.booking.bookingCode,
        price: match.booking.price,
        paymentOrderId: match.booking.paymentOrderId,
        paymentId: match.booking.paymentId,
        paymentCapturedAt: match.booking.paymentCapturedAt,
      }
    : null,
  participants: (match.participants ?? [])
    .filter((participant) => Number(participant.amountPaid ?? 0) > 0)
    .map(serializeOpenMatchPaymentParticipant),
  financials: serializeOpenMatchFinancials(match),
  payoutRelease: serializeOpenMatchPayoutRelease(match.payoutRelease),
});

const buildPaymentLedgerWhere = ({ search, ownerUserId } = {}) => {
  const trimmedSearch = search?.trim();

  return {
    ...(ownerUserId
      ? {
          turf: {
            ownerUserId,
            createdById: ownerUserId,
          },
        }
      : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { matchCode: { contains: trimmedSearch, mode: "insensitive" } },
            { title: { contains: trimmedSearch, mode: "insensitive" } },
            { sport: { contains: trimmedSearch, mode: "insensitive" } },
            { turf: { name: { contains: trimmedSearch, mode: "insensitive" } } },
            { host: { email: { contains: trimmedSearch, mode: "insensitive" } } },
            { participants: { some: { paymentOrderId: { contains: trimmedSearch, mode: "insensitive" } } } },
            { participants: { some: { paymentId: { contains: trimmedSearch, mode: "insensitive" } } } },
            { participants: { some: { user: { email: { contains: trimmedSearch, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
};

const findPaymentMatchById = async (matchId, ownerUserId) => {
  const match = await prisma.openMatch.findFirst({
    where: {
      id: matchId,
      ...buildPaymentLedgerWhere({ ownerUserId }),
    },
    include: paymentMatchInclude,
  });

  if (!match) throw AppError.notFound("Host match payment");
  return match;
};

const resolveEligibleAt = (match) => match.payoutEligibleAt ?? match.sessionEndAt ?? match.slot?.endAt ?? new Date();

const getOpenMatchCancellationPlan = (match, cancellationPolicy) =>
  resolveCancellationPlan({
    policy: cancellationPolicy,
    turf: match?.turf ?? null,
    kind: "OPEN_MATCH",
    startAt: match?.sessionStartAt ?? match?.slot?.startAt ?? null,
    amount: Number(match?.teamEntryFee ?? match?.entryFeePerPlayer ?? 0),
  });

export const listOpenMatchPaymentLedger = async ({
  page = 1,
  limit = 20,
  search,
  status,
  ownerUserId,
} = {}) => {
  const where = buildPaymentLedgerWhere({ search, ownerUserId });
  const [matches, participantMetrics] = await Promise.all([
    prisma.openMatch.findMany({
      where,
      include: paymentMatchInclude,
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 500,
    }),
    prisma.openMatchParticipant.aggregate({
      where: {
        status: "PAID",
        match: where,
      },
      _count: { id: true },
      _sum: { amountPaid: true },
    }),
  ]);
  const cancellationPolicy = await getCancellationPolicyRecord();

  await Promise.allSettled(
    matches
      .filter((match) => {
        const status = deriveOpenMatchStatus(match);
        const financials = serializeOpenMatchFinancials(match);
        return status === "CANCELLED_REFUND" || financials.payoutStatus === "ELIGIBLE" || financials.payoutStatus === "REFUND_REQUIRED";
      })
      .map((match) => reconcileOpenMatchAutomation(match.id)),
  );

  const refreshedMatches = await prisma.openMatch.findMany({
    where,
    include: paymentMatchInclude,
    orderBy: { createdAt: "desc" },
    skip: 0,
    take: 500,
  });

  const serializedMatches = refreshedMatches.map((match) => {
    const cancellationPlan = getOpenMatchCancellationPlan(match, cancellationPolicy);
    return serializeOpenMatchPayment({ ...match, cancellationPolicy: cancellationPlan });
  });
  const filteredMatches = status ? serializedMatches.filter((match) => match.status === status) : serializedMatches;
  const startIndex = (page - 1) * limit;
  const pagedMatches = filteredMatches.slice(startIndex, startIndex + limit);

  return {
    matches: pagedMatches,
    pagination: {
      page,
      limit,
      total: filteredMatches.length,
      totalPages: Math.max(1, Math.ceil(filteredMatches.length / limit)),
    },
    metrics: {
      matchCount: filteredMatches.length,
      paidParticipantCount: participantMetrics._count.id,
      collectedAmount: participantMetrics._sum.amountPaid ?? 0,
    },
  };
};

export const confirmOpenMatchOfflineCollection = async ({ ownerUserId, matchId, amountCollected, note }) => {
  const match = await findPaymentMatchById(matchId, ownerUserId);
  const financials = serializeOpenMatchFinancials(match);

  if (["RELEASED", "REFUNDED"].includes(financials.payoutStatus)) {
    throw AppError.conflict("This host match payout has already been closed");
  }

  if (["REFUND_REQUIRED", "CANCELLED"].includes(financials.settlementState)) {
    throw AppError.conflict("Offline collection cannot be added for a cancelled host match");
  }

  if (financials.outstandingCollectionAmount <= 0) {
    throw AppError.conflict("No remaining turf balance is pending for this host match");
  }

  const normalizedNote = note?.trim() || null;
  const resolvedAmount = amountCollected ?? financials.outstandingCollectionAmount;

  if (!Number.isInteger(resolvedAmount) || resolvedAmount <= 0) {
    throw AppError.validation("Collected amount must be a positive whole number");
  }

  if (resolvedAmount > financials.outstandingCollectionAmount) {
    throw AppError.validation("Collected amount cannot be more than the remaining turf balance");
  }

  const updatedMatch = await prisma.openMatch.update({
    where: { id: matchId },
    data: {
      offlineCollectionAmount: { increment: resolvedAmount },
      offlineCollectionConfirmedAt: new Date(),
      offlineCollectionNote: normalizedNote,
      ...(financials.outstandingCollectionAmount - resolvedAmount <= 0
        ? {
            payoutEligibleAt: resolveEligibleAt(match),
          }
        : {}),
    },
    include: paymentMatchInclude,
  });

  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getOpenMatchCancellationPlan(updatedMatch, cancellationPolicy);
  return serializeOpenMatchPayment({ ...updatedMatch, cancellationPolicy: cancellationPlan });
};

export const markOpenMatchPayoutReleased = async ({ matchId, payoutReference }) => {
  const match = await findPaymentMatchById(matchId);
  const updatedMatch = await triggerOpenMatchPayoutRelease(match.id);
  if (payoutReference?.trim()) {
    await prisma.openMatch.update({
      where: { id: match.id },
      data: { payoutReference: payoutReference.trim() },
    });
  }
  const refreshedMatch = await findPaymentMatchById(matchId);
  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getOpenMatchCancellationPlan(refreshedMatch ?? updatedMatch, cancellationPolicy);
  return serializeOpenMatchPayment({ ...(refreshedMatch ?? updatedMatch), cancellationPolicy: cancellationPlan });
};

export const cancelOpenMatchPayment = async ({ matchId, ownerUserId, reason, actorRole = "ADMIN" }) => {
  const normalizedReason = reason?.trim();
  if (!normalizedReason) {
    throw AppError.validation("Cancellation reason is required");
  }

  const match = await findPaymentMatchById(matchId, ownerUserId);
  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getOpenMatchCancellationPlan(match, cancellationPolicy);
  if (!cancellationPlan.canCancel || ["CANCELLED", "CANCELLED_REFUND", "COMPLETED"].includes(deriveOpenMatchStatus(match))) {
    throw AppError.conflict("This host match can no longer be cancelled");
  }

  const hasPaidParticipants = (match.participants ?? []).some((participant) => Number(participant.amountPaid ?? 0) > 0);
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
        where: {
          id: { in: slotIds },
        },
        data: {
          status: "AVAILABLE",
        },
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
        offlineCollectionNote: [match.offlineCollectionNote, `Cancelled by ${actorRole}: ${normalizedReason}`].filter(Boolean).join(" | "),
      },
    });
  });

  if (hasPaidParticipants && cancellationPlan.refundPercent > 0) {
    await forceOpenMatchRefunds(match.id, cancellationPlan.refundPercent);
  }

  const refreshedMatch = await findPaymentMatchById(matchId, ownerUserId);
  const finalCancellationPlan = getOpenMatchCancellationPlan(refreshedMatch, cancellationPolicy);
  return serializeOpenMatchPayment({ ...refreshedMatch, cancellationPolicy: finalCancellationPlan });
};
