import { prisma } from "../config/prisma.js";

const CANCELLATION_POLICY_ID = "cancellation-policy-master";

const DEFAULT_POLICY = {
  bookingFullRefundHours: 24,
  bookingPartialRefundHours: 6,
  bookingPartialRefundPercent: 50,
  bookingNoRefundHours: 1,
  openMatchFullRefundHours: 24,
  openMatchPartialRefundHours: 6,
  openMatchPartialRefundPercent: 50,
  openMatchNoRefundHours: 1,
};

const extractVenuePolicy = (turf, kind) => {
  if (!turf) return null;

  if (kind === "OPEN_MATCH") {
    if (!turf.openMatchCancellationOverrideEnabled) return null;
    return {
      fullRefundHours: turf.openMatchCancellationFullRefundHours,
      partialRefundHours: turf.openMatchCancellationPartialRefundHours,
      partialRefundPercent: turf.openMatchCancellationPartialRefundPercent,
      noRefundHours: turf.openMatchCancellationNoRefundHours,
      source: "VENUE",
    };
  }

  if (!turf.bookingCancellationOverrideEnabled) return null;
  return {
    fullRefundHours: turf.bookingCancellationFullRefundHours,
    partialRefundHours: turf.bookingCancellationPartialRefundHours,
    partialRefundPercent: turf.bookingCancellationPartialRefundPercent,
    noRefundHours: turf.bookingCancellationNoRefundHours,
    source: "VENUE",
  };
};

const clampInt = (value, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
};

const normalizePolicy = (input = {}) => {
  const bookingFullRefundHours = clampInt(input.bookingFullRefundHours ?? DEFAULT_POLICY.bookingFullRefundHours, 0, 168);
  const bookingPartialRefundHours = clampInt(
    input.bookingPartialRefundHours ?? DEFAULT_POLICY.bookingPartialRefundHours,
    0,
    bookingFullRefundHours,
  );
  const bookingNoRefundHours = clampInt(
    input.bookingNoRefundHours ?? DEFAULT_POLICY.bookingNoRefundHours,
    0,
    bookingPartialRefundHours,
  );
  const openMatchFullRefundHours = clampInt(input.openMatchFullRefundHours ?? DEFAULT_POLICY.openMatchFullRefundHours, 0, 168);
  const openMatchPartialRefundHours = clampInt(
    input.openMatchPartialRefundHours ?? DEFAULT_POLICY.openMatchPartialRefundHours,
    0,
    openMatchFullRefundHours,
  );
  const openMatchNoRefundHours = clampInt(
    input.openMatchNoRefundHours ?? DEFAULT_POLICY.openMatchNoRefundHours,
    0,
    openMatchPartialRefundHours,
  );

  return {
    bookingFullRefundHours,
    bookingPartialRefundHours,
    bookingPartialRefundPercent: clampInt(input.bookingPartialRefundPercent ?? DEFAULT_POLICY.bookingPartialRefundPercent, 0, 100),
    bookingNoRefundHours,
    openMatchFullRefundHours,
    openMatchPartialRefundHours,
    openMatchPartialRefundPercent: clampInt(
      input.openMatchPartialRefundPercent ?? DEFAULT_POLICY.openMatchPartialRefundPercent,
      0,
      100,
    ),
    openMatchNoRefundHours,
  };
};

const serializeCancellationPolicy = (policy) => ({
  bookingFullRefundHours: policy.bookingFullRefundHours,
  bookingPartialRefundHours: policy.bookingPartialRefundHours,
  bookingPartialRefundPercent: policy.bookingPartialRefundPercent,
  bookingNoRefundHours: policy.bookingNoRefundHours,
  openMatchFullRefundHours: policy.openMatchFullRefundHours,
  openMatchPartialRefundHours: policy.openMatchPartialRefundHours,
  openMatchPartialRefundPercent: policy.openMatchPartialRefundPercent,
  openMatchNoRefundHours: policy.openMatchNoRefundHours,
});

export const getCancellationPolicyRecord = async () =>
  prisma.cancellationPolicySetting.upsert({
    where: { id: CANCELLATION_POLICY_ID },
    update: {},
    create: {
      id: CANCELLATION_POLICY_ID,
      ...DEFAULT_POLICY,
    },
  });

export const getCancellationPolicyForAdmin = async () => serializeCancellationPolicy(await getCancellationPolicyRecord());

export const updateCancellationPolicy = async (input) =>
  serializeCancellationPolicy(
    await prisma.cancellationPolicySetting.upsert({
      where: { id: CANCELLATION_POLICY_ID },
      update: normalizePolicy(input),
      create: {
        id: CANCELLATION_POLICY_ID,
        ...normalizePolicy(input),
      },
    }),
  );

const hoursUntil = (startAt, now = new Date()) => {
  if (!startAt) return null;
  return (new Date(startAt).getTime() - now.getTime()) / (60 * 60 * 1000);
};

const resolveWindowConfig = (policy, kind, turf) => {
  const venuePolicy = extractVenuePolicy(turf, kind);
  if (venuePolicy) return venuePolicy;

  return kind === "OPEN_MATCH"
    ? {
        fullRefundHours: Number(policy?.openMatchFullRefundHours ?? DEFAULT_POLICY.openMatchFullRefundHours),
        partialRefundHours: Number(policy?.openMatchPartialRefundHours ?? DEFAULT_POLICY.openMatchPartialRefundHours),
        partialRefundPercent: Number(policy?.openMatchPartialRefundPercent ?? DEFAULT_POLICY.openMatchPartialRefundPercent),
        noRefundHours: Number(policy?.openMatchNoRefundHours ?? DEFAULT_POLICY.openMatchNoRefundHours),
        source: "MASTER",
      }
    : {
        fullRefundHours: Number(policy?.bookingFullRefundHours ?? DEFAULT_POLICY.bookingFullRefundHours),
        partialRefundHours: Number(policy?.bookingPartialRefundHours ?? DEFAULT_POLICY.bookingPartialRefundHours),
        partialRefundPercent: Number(policy?.bookingPartialRefundPercent ?? DEFAULT_POLICY.bookingPartialRefundPercent),
        noRefundHours: Number(policy?.bookingNoRefundHours ?? DEFAULT_POLICY.bookingNoRefundHours),
        source: "MASTER",
      };
};

export const resolveCancellationPlan = ({ policy, turf = null, kind, startAt, amount = 0, now = new Date() }) => {
  const window = resolveWindowConfig(policy, kind, turf);
  const remainingHours = hoursUntil(startAt, now);

  if (remainingHours === null) {
    return {
      canCancel: true,
      refundPercent: 100,
      refundAmount: Math.max(0, Math.round(Number(amount) || 0)),
      remainingHours: null,
      policyWindow: window,
      tier: "FULL",
      source: window.source,
    };
  }

  if (remainingHours >= window.fullRefundHours) {
    return {
      canCancel: true,
      refundPercent: 100,
      refundAmount: Math.max(0, Math.round(Number(amount) || 0)),
      remainingHours,
      policyWindow: window,
      tier: "FULL",
      source: window.source,
    };
  }

  if (remainingHours >= window.partialRefundHours) {
    const refundAmount = Math.round((Math.max(0, Number(amount) || 0) * window.partialRefundPercent) / 100);
    return {
      canCancel: true,
      refundPercent: window.partialRefundPercent,
      refundAmount,
      remainingHours,
      policyWindow: window,
      tier: "PARTIAL",
      source: window.source,
    };
  }

  if (remainingHours >= window.noRefundHours) {
    return {
      canCancel: true,
      refundPercent: 0,
      refundAmount: 0,
      remainingHours,
      policyWindow: window,
      tier: "NO_REFUND",
      source: window.source,
    };
  }

  return {
    canCancel: false,
    refundPercent: 0,
    refundAmount: 0,
    remainingHours,
    policyWindow: window,
    tier: "LOCKED",
    source: window.source,
  };
};

export const serializeCancellationPolicySource = (turf, kind) => {
  const overrideEnabled = kind === "OPEN_MATCH" ? Boolean(turf?.openMatchCancellationOverrideEnabled) : Boolean(turf?.bookingCancellationOverrideEnabled);
  if (!overrideEnabled) return { source: "MASTER", overrideEnabled: false };
  return {
    source: "VENUE",
    overrideEnabled: true,
  };
};
