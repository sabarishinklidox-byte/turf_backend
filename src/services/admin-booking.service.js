import { prisma } from "../config/prisma.js";
import { reconcileDirectBookingPayoutAutomationBatch } from "./booking-payment-automation.service.js";

const serializeAdminBooking = (booking) => {
  const isOpenMatchReservation = Boolean(booking.openMatch || booking.slot?.openMatch || booking.slot?.openMatchSlots?.length);
  const now = Date.now();
  const startAt = booking.slot?.startAt ? new Date(booking.slot.startAt).getTime() : null;
  const endAt = booking.slot?.endAt ? new Date(booking.slot.endAt).getTime() : null;

  let viewStatus = "UPCOMING";
  if (booking.status === "CANCELLED") {
    viewStatus = "CANCELLED";
  } else if (endAt && endAt < now) {
    viewStatus = "COMPLETED";
  } else if (startAt && startAt <= now && (!endAt || endAt >= now)) {
    viewStatus = "ONGOING";
  }

  return {
    id: booking.id,
    bookingCode: booking.bookingCode,
    status: booking.status,
    viewStatus,
    price: booking.price,
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
    createdAt: booking.createdAt,
    cancelledAt: booking.cancelledAt,
    isOpenMatchReservation,
    paymentNote:
      booking.status === "CANCELLED"
        ? booking.paymentStatus === "REFUNDED"
          ? "This booking was cancelled and the user refund was completed."
          : booking.refundStatus === "FAILED"
            ? "This booking was cancelled, but the refund is still blocked."
            : booking.paymentId
              ? "This booking was cancelled. Refund tracking is active for the original payment source."
              : "This booking was cancelled."
        : "This booking payment is confirmed.",
    refunds:
      (booking.paymentRefunds ?? []).map((refund) => ({
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
      })),
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
          state: booking.turf.state,
          ownerName: booking.turf.ownerName,
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
          sport: booking.openMatch.sport,
          status: booking.openMatch.status,
        }
      : null,
  };
};

export const listAdminBookings = async ({ page, limit, search, status, bookingType, city, turfId }) => {
  const filters = [];

  if (status) {
    filters.push({ status });
  }

  if (bookingType === "OPEN_MATCH") {
    filters.push({
      OR: [
        { openMatch: { isNot: null } },
        { slot: { openMatch: { isNot: null } } },
        { slot: { openMatchSlots: { some: {} } } },
      ],
    });
  } else if (bookingType === "DIRECT") {
    filters.push({
      AND: [
        { openMatch: null },
        { slot: { openMatch: null } },
        { slot: { openMatchSlots: { none: {} } } },
      ],
    });
  }

  if (search) {
    filters.push({
      OR: [
        { bookingCode: { contains: search, mode: "insensitive" } },
        { user: { firstName: { contains: search, mode: "insensitive" } } },
        { user: { lastName: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { user: { phone: { contains: search } } },
        { turf: { name: { contains: search, mode: "insensitive" } } },
        { turf: { city: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  if (city) {
    filters.push({
      turf: {
        city: { equals: city, mode: "insensitive" },
      },
    });
  }

  if (turfId) {
    filters.push({ turfId });
  }

  const where = filters.length ? { AND: filters } : {};

  const include = {
    user: true,
    turf: true,
    paymentRefunds: {
      orderBy: { requestedAt: "desc" },
    },
    openMatch: true,
    slot: {
      include: {
        openMatch: true,
        openMatchSlots: true,
      },
    },
  };

  const [initialItems, filteredTotal, total, confirmed, cancelled, directBookings, openMatchBookings, confirmedRevenue, recentBookings] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({ where }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: "CONFIRMED" } }),
    prisma.booking.count({ where: { status: "CANCELLED" } }),
    prisma.booking.count({
      where: {
        openMatch: null,
        slot: { openMatch: null, openMatchSlots: { none: {} } },
      },
    }),
    prisma.booking.count({
      where: {
        OR: [
          { openMatch: { isNot: null } },
          { slot: { openMatch: { isNot: null } } },
          { slot: { openMatchSlots: { some: {} } } },
        ],
      },
    }),
    prisma.booking.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { price: true },
    }),
    prisma.booking.findMany({
      include,
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
    }),
  ]);

  const directBookingIds = initialItems
    .filter((booking) => !(booking.openMatch || booking.slot?.openMatch || booking.slot?.openMatchSlots?.length))
    .map((booking) => booking.id);

  if (directBookingIds.length) {
    await reconcileDirectBookingPayoutAutomationBatch(directBookingIds);
  }

  const items =
    directBookingIds.length > 0
      ? await prisma.booking.findMany({
          where,
          include,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        })
      : initialItems;

  const audit = recentBookings.flatMap((booking) => {
    const bookingLabel = booking.bookingCode;
    const userName = [booking.user?.firstName, booking.user?.lastName].filter(Boolean).join(" ") || booking.user?.email || "User";
    const venueName = booking.turf?.name ?? "Venue";

    const createdEvent = {
      id: `${booking.id}-created`,
      kind: "BOOKED",
      title: `${bookingLabel} booked`,
      subtitle: `${userName} reserved ${venueName}`,
      occurredAt: booking.createdAt,
    };

    if (!booking.cancelledAt) return [createdEvent];

    return [
      {
        id: `${booking.id}-cancelled`,
        kind: "CANCELLED",
        title: `${bookingLabel} cancelled`,
        subtitle: `${userName} booking was cancelled`,
        occurredAt: booking.cancelledAt,
      },
      createdEvent,
    ];
  }).sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()).slice(0, 8);

  return {
    items: items.map(serializeAdminBooking),
    metrics: {
      total,
      confirmed,
      cancelled,
      directBookings,
      openMatchBookings,
      revenue: confirmedRevenue._sum.price ?? 0,
    },
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
    },
    audit,
  };
};
