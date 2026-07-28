import { prisma } from "../config/prisma.js";

const formatShortDate = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);

const formatLongDate = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);

const toSeriesMap = (dates) =>
  dates.reduce((accumulator, date) => {
    accumulator[date.toISOString().slice(0, 10)] = {
      date: date.toISOString(),
      label: formatShortDate(date),
      bookings: 0,
      revenue: 0,
      cancelled: 0,
    };
    return accumulator;
  }, {});

const getCurrentMonthWindow = () => {
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const endAt = new Date();
  return { rangeStart, endAt };
};

const getDateWindow = ({ fromDate, toDate }) => {
  const { rangeStart: defaultStart, endAt: defaultEnd } = getCurrentMonthWindow();
  const rangeStart = fromDate
    ? new Date(`${fromDate}T00:00:00.000`)
    : defaultStart;
  const endAt = toDate
    ? new Date(`${toDate}T23:59:59.999`)
    : defaultEnd;
  const days = Math.max(
    1,
    Math.floor((endAt.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );

  const previousEnd = new Date(rangeStart);
  previousEnd.setMilliseconds(previousEnd.getMilliseconds() - 1);

  const previousStart = new Date(rangeStart);
  previousStart.setDate(previousStart.getDate() - days);

  return {
    days,
    label: `${formatLongDate(rangeStart)} - ${formatLongDate(endAt)}`,
    rangeStart,
    endAt,
    previousStart,
    previousEnd,
  };
};

const calculateGrowth = (current, previous) => {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

export const getAdminReports = async ({ fromDate, toDate }) => {
  const {
    days,
    label,
    rangeStart,
    endAt,
    previousStart,
    previousEnd,
  } = getDateWindow({ fromDate, toDate });

  const bookingSampleStart = new Date(previousStart);
  bookingSampleStart.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeUsers,
    totalTurfs,
    approvedTurfs,
    activeTurfs,
    liveTournaments,
    completedTournaments,
    liveOpenMatches,
    totalRevenueAggregate,
    bookingSamples,
    recentBookings,
    tournamentsInRange,
    openMatchesInRange,
    approvedActiveTurfs,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.turf.count(),
    prisma.turf.count({ where: { status: "APPROVED" } }),
    prisma.turf.count({ where: { status: "APPROVED", isActive: true } }),
    prisma.tournament.count({
      where: {
        status: { in: ["OPEN", "FULL", "ACTIVE"] },
      },
    }),
    prisma.tournament.count({
      where: { status: "COMPLETED" },
    }),
    prisma.openMatch.count({
      where: {
        status: { in: ["OPEN", "PAYMENT_PENDING", "READY", "FULL"] },
      },
    }),
    prisma.booking.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { price: true },
    }),
    prisma.booking.findMany({
      where: {
        createdAt: {
          gte: bookingSampleStart,
          lte: endAt,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        bookingCode: true,
        createdAt: true,
        price: true,
        status: true,
        cancelledAt: true,
        turf: {
          select: {
            id: true,
            name: true,
            city: true,
            state: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    }),
    prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        bookingCode: true,
        createdAt: true,
        price: true,
        status: true,
        turf: {
          select: {
            name: true,
            city: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    }),
    prisma.tournament.count({
      where: {
        createdAt: {
          gte: rangeStart,
          lte: endAt,
        },
      },
    }),
    prisma.openMatch.count({
      where: {
        createdAt: {
          gte: rangeStart,
          lte: endAt,
        },
      },
    }),
    prisma.turf.findMany({
      where: {
        status: "APPROVED",
        isActive: true,
      },
      select: {
        sports: true,
      },
    }),
  ]);

  const rangeDates = Array.from({ length: days }, (_unused, index) => {
    const date = new Date(rangeStart);
    date.setDate(rangeStart.getDate() + index);
    return date;
  });

  const seriesMap = toSeriesMap(rangeDates);

  let bookingsInRange = 0;
  let previousBookingsInRange = 0;
  let revenueInRange = 0;
  let previousRevenueInRange = 0;
  let cancelledInRange = 0;

  const venueMap = new Map();
  const cityMap = new Map();

  bookingSamples.forEach((booking) => {
    const bookingTime = new Date(booking.createdAt);
    const isInCurrentRange = bookingTime >= rangeStart && bookingTime <= endAt;
    const isInPreviousRange = bookingTime >= previousStart && bookingTime <= previousEnd;

    if (isInCurrentRange) {
      if (booking.status === "CONFIRMED") {
        bookingsInRange += 1;
        revenueInRange += booking.price ?? 0;
      } else if (booking.status === "CANCELLED") {
        cancelledInRange += 1;
      }

      const key = bookingTime.toISOString().slice(0, 10);
      const bucket = seriesMap[key];
      if (bucket) {
        if (booking.status === "CONFIRMED") {
          bucket.bookings += 1;
          bucket.revenue += booking.price ?? 0;
        } else if (booking.status === "CANCELLED") {
          bucket.cancelled += 1;
        }
      }

      if (booking.status === "CONFIRMED" && booking.turf) {
        const venueKey = booking.turf.id;
        const currentVenue = venueMap.get(venueKey) ?? {
          turfId: booking.turf.id,
          turfName: booking.turf.name,
          city: booking.turf.city,
          state: booking.turf.state,
          bookings: 0,
          revenue: 0,
        };
        currentVenue.bookings += 1;
        currentVenue.revenue += booking.price ?? 0;
        venueMap.set(venueKey, currentVenue);

        const cityKey = `${booking.turf.city}__${booking.turf.state}`;
        const currentCity = cityMap.get(cityKey) ?? {
          city: booking.turf.city,
          state: booking.turf.state,
          bookings: 0,
          revenue: 0,
        };
        currentCity.bookings += 1;
        currentCity.revenue += booking.price ?? 0;
        cityMap.set(cityKey, currentCity);
      }
    }

    if (isInPreviousRange && booking.status === "CONFIRMED") {
      previousBookingsInRange += 1;
      previousRevenueInRange += booking.price ?? 0;
    }
  });

  const sportCoverageMap = new Map();
  approvedActiveTurfs.forEach((turf) => {
    (turf.sports ?? []).forEach((sport) => {
      sportCoverageMap.set(sport, (sportCoverageMap.get(sport) ?? 0) + 1);
    });
  });

  return {
    overview: {
      totalUsers,
      activeUsers,
      totalTurfs,
      approvedTurfs,
      activeTurfs,
      liveTournaments,
      completedTournaments,
      liveOpenMatches,
      totalRevenue: totalRevenueAggregate._sum.price ?? 0,
    },
    range: {
      key: `${rangeStart.toISOString()}_${endAt.toISOString()}`,
      label,
      startAt: rangeStart,
      endAt,
      previousStartAt: previousStart,
      previousEndAt: previousEnd,
    },
    performance: {
      bookingsInRange,
      previousBookingsInRange,
      bookingGrowth: calculateGrowth(bookingsInRange, previousBookingsInRange),
      revenueInRange,
      previousRevenueInRange,
      revenueGrowth: calculateGrowth(revenueInRange, previousRevenueInRange),
      cancelledInRange,
      tournamentsInRange,
      openMatchesInRange,
    },
    bookingTrend: Object.values(seriesMap),
    topVenues: [...venueMap.values()]
      .sort((left, right) => right.revenue - left.revenue || right.bookings - left.bookings)
      .slice(0, 6),
    topCities: [...cityMap.values()]
      .sort((left, right) => right.revenue - left.revenue || right.bookings - left.bookings)
      .slice(0, 6),
    sportCoverage: [...sportCoverageMap.entries()]
      .map(([sport, venueCount]) => ({ sport, venueCount }))
      .sort((left, right) => right.venueCount - left.venueCount)
      .slice(0, 8),
    recentBookings: recentBookings.map((booking) => ({
      id: booking.id,
      bookingCode: booking.bookingCode,
      createdAt: booking.createdAt,
      price: booking.price,
      status: booking.status,
      turfName: booking.turf?.name ?? "Venue",
      city: booking.turf?.city ?? "",
      customerName:
        [booking.user?.firstName, booking.user?.lastName].filter(Boolean).join(" ")
        || booking.user?.email
        || "Booked user",
    })),
  };
};
