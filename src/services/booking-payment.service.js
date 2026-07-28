import { prisma } from "../config/prisma.js";
import { sendEmail } from "./email.service.js";
import {
  createBookingRefund,
  reconcileDirectBookingPayoutAutomation,
  reconcileDirectBookingPayoutAutomationBatch,
} from "./booking-payment-automation.service.js";
import { AppError } from "../utils/app-error.js";
import { getCancellationPolicyRecord, resolveCancellationPlan } from "./cancellation-policy.service.js";

const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();

const bookingPaymentInclude = {
  user: true,
  turf: true,
  slot: {
    include: {
      openMatch: true,
      openMatchSlots: true,
    },
  },
  openMatch: true,
  paymentRefunds: {
    orderBy: { requestedAt: "desc" },
  },
};

const formatDateTimeForEmail = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

const isDirectBooking = (booking) =>
  !booking?.openMatch && !booking?.slot?.openMatch && !(booking?.slot?.openMatchSlots?.length > 0);

const getDirectBookingCancellationPlan = (booking, cancellationPolicy) =>
  resolveCancellationPlan({
    policy: cancellationPolicy,
    turf: booking?.turf ?? null,
    kind: "BOOKING",
    startAt: booking?.slot?.startAt ?? null,
    amount: Number(booking?.price ?? 0),
  });

const getDirectBookingFinancials = (booking, cancellationPlan, latestRefundAmount = 0) => {
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

const serializeRefund = (refund) => ({
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

const serializeBookingPayment = (booking, cancellationPolicy = null) => {
  const cancellationPlan = getDirectBookingCancellationPlan(booking, cancellationPolicy);
  const latestRefund = booking.paymentRefunds?.[0] ?? null;
  const latestRefundAmount = Number(latestRefund?.amount ?? 0);
  const financials = getDirectBookingFinancials(booking, cancellationPlan, latestRefundAmount);

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
  canCancelBooking:
    Boolean(booking && isDirectBooking(booking) && booking.status === "CONFIRMED") && cancellationPlan.canCancel,
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
          : "This slot booking was cancelled and the refund was completed to the original payment source."
        : booking.refundStatus === "FAILED"
          ? "This slot booking was cancelled, but the refund could not be completed yet."
          : booking.paymentId && cancellationPlan.tier === "NO_REFUND"
            ? "This slot booking was cancelled inside the no-refund window. No refund was applied."
          : booking.paymentId
            ? "This slot booking was cancelled. Refund tracking is active for the original payment source."
            : "This slot booking was cancelled."
      : "This slot booking payment is confirmed.",
  user: booking.user
    ? {
        id: booking.user.id,
        name: [booking.user.firstName, booking.user.lastName].filter(Boolean).join(" ").trim(),
        email: booking.user.email,
        phone: booking.user.phone,
      }
    : null,
  turf: booking.turf
    ? {
        id: booking.turf.id,
        turfName: booking.turf.name,
        city: booking.turf.city,
        state: booking.turf.state,
        ownerName: booking.turf.ownerName,
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
    refunds: (booking.paymentRefunds ?? []).map(serializeRefund),
  };
};

const buildDirectBookingPaymentWhere = ({ search, status, ownerUserId } = {}) => {
  const trimmedSearch = search?.trim();
  const filters = [
    { openMatch: null },
    { slot: { openMatch: null, openMatchSlots: { none: {} } } },
  ];

  if (ownerUserId) {
    filters.push({
      turf: {
        ownerUserId,
        createdById: ownerUserId,
      },
    });
  }

  if (status === "CONFIRMED") {
    filters.push({ status: "CONFIRMED" });
  } else if (status === "CANCELLED") {
    filters.push({ status: "CANCELLED" });
  } else if (status === "REFUND_PENDING") {
    filters.push({ status: "CANCELLED", refundStatus: "CREATED" });
  } else if (status === "REFUNDED") {
    filters.push({ paymentStatus: "REFUNDED" });
  } else if (status === "REFUND_FAILED") {
    filters.push({ status: "CANCELLED", refundStatus: "FAILED" });
  }

  if (trimmedSearch) {
    filters.push({
      OR: [
        { bookingCode: { contains: trimmedSearch, mode: "insensitive" } },
        { paymentOrderId: { contains: trimmedSearch, mode: "insensitive" } },
        { paymentId: { contains: trimmedSearch, mode: "insensitive" } },
        { user: { email: { contains: trimmedSearch, mode: "insensitive" } } },
        { user: { firstName: { contains: trimmedSearch, mode: "insensitive" } } },
        { user: { lastName: { contains: trimmedSearch, mode: "insensitive" } } },
        { turf: { name: { contains: trimmedSearch, mode: "insensitive" } } },
        { turf: { city: { contains: trimmedSearch, mode: "insensitive" } } },
        { paymentRefunds: { some: { razorpayRefundId: { contains: trimmedSearch, mode: "insensitive" } } } },
      ],
    });
  }

  return { AND: filters };
};

const findDirectBookingPayment = async (bookingId, ownerUserId) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      ...buildDirectBookingPaymentWhere({ ownerUserId }),
    },
    include: bookingPaymentInclude,
  });

  if (!booking) throw AppError.notFound("Booking payment");
  return booking;
};

const sendOwnerCancelledBookingEmail = async (booking) => {
  if (!booking?.user?.email) return;

  const link = `${appBaseUrl.replace(/\/$/, "")}/user/bookings`;
  const refund = booking.paymentRefunds?.[0] ?? null;
  const refundLine =
    !booking.paymentId
      ? "No online payment reference was stored for this booking."
      : booking.paymentStatus === "REFUNDED"
      ? "Refund completed to your original payment source."
      : booking.refundStatus === "FAILED"
        ? booking.refundFailureReason || "Refund could not be completed yet."
        : booking.status === "CANCELLED" && !booking.refundStatus && booking.paymentStatus !== "REFUNDED"
          ? "No refund was applied because this booking was cancelled inside the no-refund window."
        : "Refund has been started to your original payment source.";

  await sendEmail({
    to: booking.user.email,
    subject: `Your PlayArena booking ${booking.bookingCode} was cancelled by the turf owner`,
    text: `Hi ${[booking.user.firstName, booking.user.lastName].filter(Boolean).join(" ").trim() || "player"},\n\nYour booking was cancelled by the turf owner.\n\nBooking: ${booking.bookingCode}\nVenue: ${booking.turf?.name ?? "PlayArena venue"}\nTime: ${booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Not set"}\nReason: ${booking.cancellationReason ?? "Venue unavailable"}\n${refundLine}\n${refund?.razorpayRefundId ? `Refund reference: ${refund.razorpayRefundId}\n` : ""}\nOpen your bookings here:\n${link}\n\n- PlayArena`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10245e; line-height: 1.6;">
        <p style="margin:0 0 8px;">Hi ${[booking.user.firstName, booking.user.lastName].filter(Boolean).join(" ").trim() || "player"},</p>
        <h2 style="margin:0 0 12px;">Your slot booking was cancelled by the turf owner</h2>
        <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#f7faff;border:1px solid #dbe7ff;">
          <div style="font-size:18px;font-weight:800;color:#10245e;">${booking.bookingCode}</div>
          <div style="margin-top:6px;font-size:14px;color:#5f6f92;">${booking.turf?.name ?? "PlayArena venue"}</div>
          <div style="margin-top:4px;font-size:14px;color:#5f6f92;">${booking.slot?.startAt ? formatDateTimeForEmail(booking.slot.startAt) : "Time not set"}</div>
        </div>
        <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;">
          <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#c2410c;">Reason</div>
          <div style="margin-top:8px;font-size:14px;color:#10245e;">${booking.cancellationReason ?? "Venue unavailable"}</div>
        </div>
        <div style="margin:0 0 16px;padding:14px 16px;border-radius:16px;background:#eef6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;font-weight:900;letter-spacing:0.6px;text-transform:uppercase;color:#1646d8;">Refund update</div>
          <div style="margin-top:8px;font-size:14px;color:#10245e;">${refundLine}</div>
          ${refund?.razorpayRefundId ? `<div style="margin-top:6px;font-size:13px;color:#5f6f92;">Refund reference: ${refund.razorpayRefundId}</div>` : ""}
        </div>
        <p style="margin:0 0 18px;">
          <a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
            Open My Bookings
          </a>
        </p>
        <p style="margin:0;color:#5f6f92;">- PlayArena no-reply</p>
      </div>
    `,
  });
};

export const listDirectBookingPaymentLedger = async ({ page = 1, limit = 20, search, status, ownerUserId } = {}) => {
  const where = buildDirectBookingPaymentWhere({ search, status, ownerUserId });
  const cancellationPolicy = await getCancellationPolicyRecord();
  const [initialBookings, count, aggregates, refundedAgg, pendingCount, failedCount] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingPaymentInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({ where }),
    prisma.booking.aggregate({
      where,
      _sum: { price: true },
    }),
    prisma.booking.aggregate({
      where: { ...where, paymentStatus: "REFUNDED" },
      _sum: { price: true },
    }),
    prisma.booking.count({ where: { ...where, refundStatus: "CREATED" } }),
    prisma.booking.count({ where: { ...where, refundStatus: "FAILED" } }),
  ]);

  if (initialBookings.length) {
    await reconcileDirectBookingPayoutAutomationBatch(initialBookings.map((booking) => booking.id));
  }

  const bookings =
    initialBookings.length > 0
      ? await prisma.booking.findMany({
          where,
          include: bookingPaymentInclude,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        })
      : initialBookings;

  return {
    bookings: bookings.map((booking) => serializeBookingPayment(booking, cancellationPolicy)),
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    },
    metrics: {
      count,
      collectedAmount: aggregates._sum.price ?? 0,
      refundedAmount: refundedAgg._sum.price ?? 0,
      pendingRefundCount: pendingCount,
      failedRefundCount: failedCount,
    },
  };
};

export const cancelDirectBookingPayment = async ({ bookingId, ownerUserId, reason, actorRole = "ADMIN" }) => {
  const normalizedReason = reason?.trim();
  if (!normalizedReason) throw AppError.validation("Cancellation reason is required");

  const booking = await findDirectBookingPayment(bookingId, ownerUserId);
  const cancellationPolicy = await getCancellationPolicyRecord();
  const cancellationPlan = getDirectBookingCancellationPlan(booking, cancellationPolicy);
  if (!cancellationPlan.canCancel || !isDirectBooking(booking) || booking.status !== "CONFIRMED") {
    throw AppError.conflict("This direct booking can no longer be cancelled");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: normalizedReason,
        cancelledByRole: actorRole,
      },
    });

    await transaction.turfSlot.update({
      where: { id: booking.slotId },
      data: { status: "AVAILABLE" },
    });
  });

  const cancelledBooking = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: bookingPaymentInclude,
  });

  const refundedBooking =
    cancellationPlan.refundAmount > 0
      ? await createBookingRefund(cancelledBooking, {
          actorRole,
          reason: normalizedReason,
          amount: cancellationPlan.refundAmount,
        })
      : await reconcileDirectBookingPayoutAutomation(cancelledBooking.id);

  const finalBooking = refundedBooking ?? cancelledBooking;

  if (actorRole === "TURF_OWNER") {
    await sendOwnerCancelledBookingEmail(finalBooking).catch(() => {});
  }

  return serializeBookingPayment(finalBooking, cancellationPolicy);
};
