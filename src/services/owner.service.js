import { prisma } from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { AppError } from "../utils/app-error.js";
import { resolveCoordinatesFromAddress } from "./location.service.js";
import {
  createBookingRefund,
  reconcileDirectBookingPayoutAutomation,
  reconcileDirectBookingPayoutAutomationBatch,
} from "./booking-payment-automation.service.js";
import { getCancellationPolicyRecord, resolveCancellationPlan } from "./cancellation-policy.service.js";

const INDIA_OFFSET = "+05:30";

const serializeOwnerTurf = (turf) => ({
  id: turf.id,
  registrationNumber: turf.registrationNumber,
  turfName: turf.name,
  ownerName: turf.ownerName,
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
  amenities: turf.amenities,
  imageUrls: turf.imageUrls,
  openingTime: turf.openingTime,
  closingTime: turf.closingTime,
  payoutMethod: turf.payoutMethod ?? null,
  payoutAccountHolderName: turf.payoutAccountHolderName ?? null,
  payoutBankName: turf.payoutBankName ?? null,
  payoutAccountNumber: turf.payoutAccountNumber ?? null,
  payoutIfscCode: turf.payoutIfscCode ?? null,
  payoutUpiId: turf.payoutUpiId ?? null,
  isActive: turf.isActive,
  status: turf.status,
  statusLabel: {
    PENDING_REVIEW: "Pending Review",
    DOCUMENTS_VERIFIED: "Documents Verified",
    ACTION_REQUIRED: "Action Required",
    APPROVED: "Approved",
    REJECTED: "Rejected",
  }[turf.status],
  reviewNote: turf.reviewNote,
  slotCount: turf._count?.slots ?? 0,
});

const serializeOwnerPayoutDetails = (owner) => ({
  payoutMethod: owner.payoutMethod ?? null,
  payoutAccountHolderName: owner.payoutAccountHolderName ?? null,
  payoutBankName: owner.payoutBankName ?? null,
  payoutAccountNumber: owner.payoutAccountNumber ?? null,
  payoutIfscCode: owner.payoutIfscCode ?? null,
  payoutUpiId: owner.payoutUpiId ?? null,
});

const coordinatesFromInput = async (input) => {
  const resolved = await resolveCoordinatesFromAddress(input);
  return {
    latitude: resolved?.latitude ?? input.latitude ?? null,
    longitude: resolved?.longitude ?? input.longitude ?? null,
  };
};

const serializeSlot = (slot) => ({
  id: slot.id,
  startAt: slot.startAt,
  endAt: slot.endAt,
  price: slot.price,
  status: slot.status,
});

const serializeOwnerOpenMatchFinancials = (match) => {
  if (!match) return null;
  const totalCollectedAmount = (match.participants ?? [])
    .filter((participant) => participant.status === "PAID")
    .reduce((sum, participant) => sum + Number(participant.amountPaid ?? 0), 0);
  const totalSlotPrice = Number(match.totalSlotPrice ?? 0);
  const participantCollectionsAmount = Math.max(0, totalCollectedAmount - totalSlotPrice);
  const endAt = match.sessionEndAt ?? match.slot?.endAt ?? null;
  const hasEnded = endAt ? new Date(endAt) <= new Date() : false;

  return {
    totalCollectedAmount,
    ownerPayoutAmount: totalSlotPrice,
    hostPayoutAmount: participantCollectionsAmount,
    settlementState: hasEnded ? "READY_FOR_SETTLEMENT" : "HELD_UNTIL_MATCH_END",
  };
};

const getOwnerBookingCancellationPlan = (booking, cancellationPolicy) =>
  resolveCancellationPlan({
    policy: cancellationPolicy,
    turf: booking?.turf ?? null,
    kind: "BOOKING",
    startAt: booking?.slot?.startAt ?? null,
    amount: Number(booking?.price ?? 0),
  });

const getOwnerBookingFinancials = (booking, cancellationPlan, latestRefundAmount = 0) => {
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

const serializeOwnerBooking = (booking, cancellationPolicy = null) => {
  const cancellationPlan = getOwnerBookingCancellationPlan(booking, cancellationPolicy);
  const latestRefund = booking.paymentRefunds?.[0] ?? null;
  const latestRefundAmount = Number(latestRefund?.amount ?? 0);
  const financials = getOwnerBookingFinancials(booking, cancellationPlan, latestRefundAmount);

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
  canOwnerCancel:
    booking.status === "CONFIRMED" &&
    !(booking.openMatch || booking.slot?.openMatch || booking.slot?.openMatchSlots?.length) &&
    cancellationPlan.canCancel,
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
  isOpenMatchReservation: Boolean(booking.openMatch || booking.slot?.openMatch || booking.slot?.openMatchSlots?.length),
  paymentNote:
    booking.status === "CANCELLED"
      ? booking.paymentStatus === "REFUNDED" || latestRefundAmount >= Number(booking.price ?? 0)
        ? latestRefundAmount > 0 && latestRefundAmount < Number(booking.price ?? 0)
          ? "This direct slot booking was cancelled and a partial refund was completed for the user."
          : "This direct slot booking was cancelled and the user refund was completed."
        : booking.refundStatus === "FAILED"
          ? "This direct slot booking was cancelled, but the user refund is still blocked."
          : booking.paymentId && cancellationPlan.tier === "NO_REFUND"
            ? "This direct slot booking was cancelled inside the no-refund window. No refund was applied."
          : booking.paymentId
            ? "This direct slot booking was cancelled. Refund tracking is active for the user payment."
            : "This direct slot booking was cancelled."
      : "This direct slot booking payment is confirmed.",
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
  user: booking.user
    ? {
        id: booking.user.id,
        firstName: booking.user.firstName,
        lastName: booking.user.lastName,
        email: booking.user.email,
        phone: booking.user.phone,
      }
    : null,
  turf: booking.turf
    ? {
        id: booking.turf.id,
        turfName: booking.turf.name,
        city: booking.turf.city,
        cancellationPolicy: {
          source: booking.cancellationPolicy?.source ?? "MASTER",
          overrideEnabled: Boolean(booking.turf.bookingCancellationOverrideEnabled),
          fullRefundHours: booking.turf.bookingCancellationFullRefundHours ?? null,
          partialRefundHours: booking.turf.bookingCancellationPartialRefundHours ?? null,
          partialRefundPercent: booking.turf.bookingCancellationPartialRefundPercent ?? null,
          noRefundHours: booking.turf.bookingCancellationNoRefundHours ?? null,
        },
      }
    : null,
  slot: booking.slot
    ? {
        id: booking.slot.id,
        startAt: booking.slot.startAt,
        endAt: booking.slot.endAt,
        price: booking.slot.price,
      }
    : null,
  openMatch: booking.openMatch
    ? {
        id: booking.openMatch.id,
        title: booking.openMatch.title,
        status: booking.openMatch.status,
        financials: serializeOwnerOpenMatchFinancials(booking.openMatch),
      }
    : null,
  };
};

const serializeOwnerInventorySlot = (slot) => ({
  id: slot.id,
  price: slot.price,
  status: slot.status,
  turf: slot.turf
    ? {
        id: slot.turf.id,
        turfName: slot.turf.name,
        city: slot.turf.city,
      }
    : null,
  startAt: slot.startAt,
  endAt: slot.endAt,
});

const ownedApprovedTurf = async (ownerUserId, turfId) => {
  const turf = await prisma.turf.findFirst({
    where: { id: turfId, ownerUserId, createdById: ownerUserId, status: "APPROVED" },
  });
  if (!turf) throw AppError.notFound("Approved turf");
  return turf;
};

export const getOwnerProfile = async (ownerUserId) => {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    include: { ownerVerification: true },
  });
  if (!owner) throw AppError.notFound("Turf owner account");
  return {
    id: owner.id,
    firstName: owner.firstName,
    lastName: owner.lastName,
    email: owner.email,
    phone: owner.phone,
    payoutDetails: serializeOwnerPayoutDetails(owner),
    verificationStatus: owner.ownerVerification?.status ?? "PENDING",
    verificationNote: owner.ownerVerification?.reviewNote ?? null,
    reviewedAt: owner.ownerVerification?.reviewedAt ?? null,
  };
};

export const updateOwnerPayoutDetails = async (ownerUserId, input) => {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
  });
  if (!owner) throw AppError.notFound("Turf owner account");

  const updated = await prisma.user.update({
    where: { id: ownerUserId },
    data: {
      payoutMethod: input.payoutMethod,
      payoutAccountHolderName: input.payoutAccountHolderName || null,
      payoutBankName: input.payoutBankName || null,
      payoutAccountNumber: input.payoutAccountNumber || null,
      payoutIfscCode: input.payoutIfscCode || null,
      payoutUpiId: input.payoutUpiId || null,
    },
    include: { ownerVerification: true },
  });

  return {
    id: updated.id,
    firstName: updated.firstName,
    lastName: updated.lastName,
    email: updated.email,
    phone: updated.phone,
    payoutDetails: serializeOwnerPayoutDetails(updated),
    verificationStatus: updated.ownerVerification?.status ?? "PENDING",
    verificationNote: updated.ownerVerification?.reviewNote ?? null,
    reviewedAt: updated.ownerVerification?.reviewedAt ?? null,
  };
};

const verifiedOwner = async (ownerUserId) => {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    include: { ownerVerification: true },
  });
  if (!owner) throw AppError.notFound("Turf owner account");
  if (owner.ownerVerification?.status !== "APPROVED") {
    throw AppError.forbidden("Your turf owner account must be verified before managing venues");
  }
  return owner;
};

export const listOwnerTurfs = async (ownerUserId) => {
  const turfs = await prisma.turf.findMany({
    where: { ownerUserId, createdById: ownerUserId },
    include: { _count: { select: { slots: true } } },
    orderBy: { approvedAt: "desc" },
  });
  return turfs.map(serializeOwnerTurf);
};

export const createOwnerVenue = async (ownerUserId, input, imageUrls) => {
  const owner = await verifiedOwner(ownerUserId);
  if (!owner.phone) throw AppError.validation("Add a phone number to your owner account before creating a venue");
  if (!owner.payoutMethod) {
    throw AppError.validation("Add your common payout details in the owner dashboard before creating a venue");
  }
  const coordinates = await coordinatesFromInput(input);

  const turf = await prisma.turf.create({
    data: {
      registrationNumber: `TF-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      name: input.turfName,
      ownerName: [owner.firstName, owner.lastName].filter(Boolean).join(" "),
      ownerEmail: owner.email,
      ownerPhone: owner.phone,
      description: input.description,
      address: input.address,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      landmark: input.landmark || null,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      sports: input.sports,
      surfaceType: input.surfaceType,
      openingTime: input.openingTime,
      closingTime: input.closingTime,
      amenities: input.amenities,
      payoutMethod: owner.payoutMethod,
      payoutAccountHolderName: owner.payoutAccountHolderName || null,
      payoutBankName: owner.payoutBankName || null,
      payoutAccountNumber: owner.payoutAccountNumber || null,
      payoutIfscCode: owner.payoutIfscCode || null,
      payoutUpiId: owner.payoutUpiId || null,
      imageUrls,
      ownerUserId,
      createdById: ownerUserId,
      status: "APPROVED",
      isActive: true,
      approvedAt: new Date(),
    },
  });
  return serializeOwnerTurf({ ...turf, _count: { slots: 0 } });
};

const addDays = (dateString, days) => {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const dayOfWeek = (dateString) => {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const toMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const toDateTime = (date, minutes) => {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return new Date(`${date}T${hours}:${mins}:00${INDIA_OFFSET}`);
};

export const createOwnerSlotSchedule = async (ownerUserId, turfId, input) => {
  await verifiedOwner(ownerUserId);
  const turf = await ownedApprovedTurf(ownerUserId, turfId);
  if (!turf.isActive) throw AppError.conflict("Activate the turf before creating slots");

  const openingMinutes = toMinutes(input.openingTime);
  const closingMinutes = toMinutes(input.closingTime);
  const slots = [];

  for (let date = input.dateFrom; date <= input.dateTo; date = addDays(date, 1)) {
    if (!input.daysOfWeek.includes(dayOfWeek(date))) continue;
    for (let start = openingMinutes; start + input.slotMinutes <= closingMinutes; start += input.slotMinutes) {
      slots.push({
        turfId,
        startAt: toDateTime(date, start),
        endAt: toDateTime(date, start + input.slotMinutes),
        price: input.pricePerSlot,
      });
    }
  }

  if (slots.length === 0) throw AppError.validation("The selected schedule does not generate any slots");

  const existingSlots = await prisma.turfSlot.findMany({
    where: {
      turfId,
      startAt: { lt: toDateTime(addDays(input.dateTo, 1), 0) },
      endAt: { gt: toDateTime(input.dateFrom, 0) },
    },
    select: { startAt: true, endAt: true },
  });
  const nonOverlappingSlots = slots.filter(
    (candidate) =>
      !existingSlots.some(
        (existing) =>
          existing.startAt < candidate.endAt && existing.endAt > candidate.startAt,
      ),
  );

  const [rule, created] = await prisma.$transaction([
    prisma.turfAvailabilityRule.create({
      data: {
        turfId,
        dateFrom: toDateTime(input.dateFrom, 0),
        dateTo: toDateTime(input.dateTo, 0),
        daysOfWeek: input.daysOfWeek,
        openingTime: input.openingTime,
        closingTime: input.closingTime,
        slotMinutes: input.slotMinutes,
        pricePerSlot: input.pricePerSlot,
      },
    }),
    prisma.turfSlot.createMany({ data: nonOverlappingSlots, skipDuplicates: true }),
  ]);

  return {
    ruleId: rule.id,
    generated: slots.length,
    created: created.count,
    skipped: slots.length - created.count,
  };
};

export const listOwnerSlots = async (ownerUserId, turfId, { dateFrom, dateTo }) => {
  await ownedApprovedTurf(ownerUserId, turfId);
  const now = new Date();
  const slots = await prisma.turfSlot.findMany({
    where: {
      turfId,
      startAt: {
        gte: dateFrom ? toDateTime(dateFrom, 0) : now,
        ...(dateTo ? { lte: toDateTime(addDays(dateTo, 1), 0) } : {}),
      },
    },
    orderBy: { startAt: "asc" },
    take: 300,
  });
  return slots.map(serializeSlot);
};

export const updateOwnerSlot = async (ownerUserId, turfId, slotId, status) => {
  await ownedApprovedTurf(ownerUserId, turfId);
  const slot = await prisma.turfSlot.findFirst({ where: { id: slotId, turfId } });
  if (!slot) throw AppError.notFound("Slot");
  if (slot.status === "BOOKED") throw AppError.conflict("A booked slot cannot be changed");
  if (slot.startAt <= new Date()) throw AppError.conflict("Past slots cannot be changed");

  return serializeSlot(await prisma.turfSlot.update({ where: { id: slotId }, data: { status } }));
};

export const updateOwnerSlots = async (ownerUserId, turfId, slotIds, status) => {
  await ownedApprovedTurf(ownerUserId, turfId);
  const uniqueSlotIds = [...new Set(slotIds)];
  const slots = await prisma.turfSlot.findMany({
    where: { id: { in: uniqueSlotIds }, turfId },
    orderBy: { startAt: "asc" },
  });

  if (slots.length !== uniqueSlotIds.length) {
    throw AppError.notFound("One or more slots");
  }

  const now = new Date();
  const blockedSlot = slots.find((slot) => slot.status === "BOOKED");
  if (blockedSlot) throw AppError.conflict("A booked slot cannot be changed");

  const pastSlot = slots.find((slot) => slot.startAt <= now);
  if (pastSlot) throw AppError.conflict("Past slots cannot be changed");

  const updated = await prisma.$transaction(
    slots.map((slot) =>
      prisma.turfSlot.update({
        where: { id: slot.id },
        data: { status },
      }),
    ),
  );

  return updated.map(serializeSlot);
};

export const listOwnerBookings = async (ownerUserId) => {
  await verifiedOwner(ownerUserId);
  const cancellationPolicy = await getCancellationPolicyRecord();

  const initialBookings = await prisma.booking.findMany({
    where: {
      turf: {
        ownerUserId,
        createdById: ownerUserId,
      },
    },
    include: {
      user: true,
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
      openMatch: {
        include: {
          slot: true,
          participants: true,
        },
      },
      slot: { include: { openMatch: true, openMatchSlots: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
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
          where: {
            turf: {
              ownerUserId,
              createdById: ownerUserId,
            },
          },
          include: {
            user: true,
            turf: true,
            paymentRefunds: { orderBy: { requestedAt: "desc" } },
            openMatch: {
              include: {
                slot: true,
                participants: true,
              },
            },
            slot: { include: { openMatch: true, openMatchSlots: true } },
          },
          orderBy: [{ createdAt: "desc" }],
          take: 200,
        })
      : initialBookings;

  return bookings.map((booking) => serializeOwnerBooking(booking, cancellationPolicy));
};

export const listOwnerUnbookedSlots = async (ownerUserId) => {
  await verifiedOwner(ownerUserId);

  const slots = await prisma.turfSlot.findMany({
    where: {
      turf: {
        ownerUserId,
        createdById: ownerUserId,
      },
      status: "AVAILABLE",
      startAt: { gt: new Date() },
    },
    include: {
      turf: true,
    },
    orderBy: [{ startAt: "asc" }],
    take: 24,
  });

  return slots.map(serializeOwnerInventorySlot);
};

export const listOwnerBlockedSlots = async (ownerUserId) => {
  await verifiedOwner(ownerUserId);

  const slots = await prisma.turfSlot.findMany({
    where: {
      turf: {
        ownerUserId,
        createdById: ownerUserId,
      },
      status: "BLOCKED",
      startAt: { gt: new Date() },
    },
    include: {
      turf: true,
    },
    orderBy: [{ startAt: "asc" }],
    take: 24,
  });

  return slots.map(serializeOwnerInventorySlot);
};

export const cancelOwnerBooking = async (ownerUserId, bookingId, reason) => {
  await verifiedOwner(ownerUserId);

  const normalizedReason = reason?.trim();
  if (!normalizedReason) throw AppError.validation("Cancellation reason is required");

  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      turf: {
        ownerUserId,
        createdById: ownerUserId,
      },
    },
    include: {
      user: true,
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
      openMatch: {
        include: {
          slot: true,
          participants: true,
        },
      },
      slot: { include: { openMatch: true, openMatchSlots: true } },
    },
  });

  if (!booking) throw AppError.notFound("Booking");
  if (booking.status !== "CONFIRMED") throw AppError.conflict("Only confirmed bookings can be cancelled");
  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getOwnerBookingCancellationPlan(booking, cancellationPolicy);
  if (!cancellationPlan.canCancel) throw AppError.conflict("This booking can no longer be cancelled");
  if (booking.openMatch || booking.slot.openMatch || booking.slot.openMatchSlots.length) {
    throw AppError.conflict("Open match reserved slots cannot be cancelled from booked users");
  }

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: normalizedReason,
        cancelledByRole: "TURF_OWNER",
      },
      include: {
        user: true,
        turf: true,
        paymentRefunds: { orderBy: { requestedAt: "desc" } },
        openMatch: {
          include: {
            slot: true,
            participants: true,
          },
        },
        slot: { include: { openMatch: true, openMatchSlots: true } },
      },
    }),
    prisma.turfSlot.update({
      where: { id: booking.slotId },
      data: { status: "AVAILABLE" },
    }),
  ]);

  const cancelledBooking = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: {
      user: true,
      turf: true,
      paymentRefunds: { orderBy: { requestedAt: "desc" } },
      openMatch: {
        include: {
          slot: true,
          participants: true,
        },
      },
      slot: { include: { openMatch: true, openMatchSlots: true } },
    },
  });
  const refundedBooking =
    cancellationPlan.refundAmount > 0
      ? await createBookingRefund(cancelledBooking, {
          actorRole: "TURF_OWNER",
          reason: normalizedReason,
          amount: cancellationPlan.refundAmount,
        })
      : await reconcileDirectBookingPayoutAutomation(cancelledBooking.id);

  return serializeOwnerBooking(refundedBooking ?? cancelledBooking, cancellationPolicy);
};
