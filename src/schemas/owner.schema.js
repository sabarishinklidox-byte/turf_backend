import { z } from "zod";

const jsonArray = (fieldName) =>
  z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  }, z.array(z.string().trim().min(1)).min(1, `Select at least one ${fieldName}`));

const optionalCoordinate = (min, max) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().min(min).max(max).optional(),
  );

const payoutDetailsShape = {
  payoutMethod: z.enum(["BANK_ACCOUNT", "UPI"]),
  payoutAccountHolderName: z.string().trim().max(120).optional().or(z.literal("")),
  payoutBankName: z.string().trim().max(120).optional().or(z.literal("")),
  payoutAccountNumber: z.string().trim().max(40).optional().or(z.literal("")),
  payoutIfscCode: z.string().trim().max(20).optional().or(z.literal("")),
  payoutUpiId: z.string().trim().max(120).optional().or(z.literal("")),
};

const withPayoutValidation = (schema) =>
  schema.superRefine((value, context) => {
    if (value.payoutMethod === "BANK_ACCOUNT") {
      if (!value.payoutAccountHolderName) {
        context.addIssue({ code: "custom", path: ["payoutAccountHolderName"], message: "Account holder name is required" });
      }
      if (!value.payoutBankName) {
        context.addIssue({ code: "custom", path: ["payoutBankName"], message: "Bank name is required" });
      }
      if (!value.payoutAccountNumber) {
        context.addIssue({ code: "custom", path: ["payoutAccountNumber"], message: "Account number is required" });
      }
      if (!value.payoutIfscCode) {
        context.addIssue({ code: "custom", path: ["payoutIfscCode"], message: "IFSC code is required" });
      }
    }

    if (value.payoutMethod === "UPI" && !value.payoutUpiId) {
      context.addIssue({ code: "custom", path: ["payoutUpiId"], message: "UPI ID is required" });
    }
  });

export const createOwnerVenueSchema = z.object({
  body: z
    .object({
      turfName: z.string().trim().min(3).max(120),
      description: z.string().trim().min(20).max(2000),
      address: z.string().trim().min(8).max(300),
      city: z.string().trim().min(2).max(80),
      state: z.string().trim().min(2).max(80),
      postalCode: z.string().trim().regex(/^[0-9]{6}$/),
      landmark: z.string().trim().max(120).optional().or(z.literal("")),
      latitude: optionalCoordinate(-90, 90),
      longitude: optionalCoordinate(-180, 180),
      sports: jsonArray("sport"),
      surfaceType: z.string().trim().min(1).max(80),
      openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      amenities: jsonArray("amenity"),
      termsAccepted: z.preprocess((value) => value === true || value === "true", z.literal(true)),
    }),
});

export const updateOwnerPayoutDetailsSchema = z.object({
  body: withPayoutValidation(z.object(payoutDetailsShape)),
});

export const confirmOpenMatchOfflineCollectionSchema = z.object({
  params: z.object({
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    amountCollected: z.coerce.number().int().positive().max(1000000).optional(),
    note: z.string().trim().max(240).optional(),
  }),
});

export const cancelOpenMatchSchema = z.object({
  params: z.object({
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    reason: z.string().trim().min(5).max(240),
  }),
});

export const cancelOwnerBookingSchema = z.object({
  params: z.object({
    bookingId: z.string().trim().min(1),
  }),
  body: z.object({
    reason: z.string().trim().min(5).max(240),
  }),
});

export const ownerTurfIdSchema = z.object({
  params: z.object({ turfId: z.string().trim().min(1) }),
});

export const createSlotScheduleSchema = z.object({
  params: z.object({ turfId: z.string().trim().min(1) }),
  body: z
    .object({
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
      openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      slotMinutes: z.number().int().refine((value) => [30, 60, 90].includes(value)),
      pricePerSlot: z.number().int().min(1).max(100000),
    })
    .superRefine(({ dateFrom, dateTo, openingTime, closingTime }, context) => {
      if (dateTo < dateFrom) {
        context.addIssue({ code: "custom", path: ["dateTo"], message: "End date must be after start date" });
      }
      if (closingTime <= openingTime) {
        context.addIssue({ code: "custom", path: ["closingTime"], message: "Closing time must be after opening time" });
      }
    }),
});

export const listOwnerSlotsSchema = z.object({
  params: z.object({ turfId: z.string().trim().min(1) }),
  query: z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});

export const reverseGeocodeSchema = z.object({
  query: z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  }),
});

export const searchLocationSchema = z.object({
  query: z.object({
    q: z.string().trim().min(2).max(120),
  }),
});

export const listCitiesByStateSchema = z.object({
  query: z.object({
    stateCode: z.string().trim().min(1).max(40),
  }),
});

export const updateOwnerSlotSchema = z.object({
  params: z.object({
    turfId: z.string().trim().min(1),
    slotId: z.string().trim().min(1),
  }),
  body: z.object({
    status: z.enum(["AVAILABLE", "BLOCKED"]),
  }),
});

export const bulkUpdateOwnerSlotsSchema = z.object({
  params: z.object({
    turfId: z.string().trim().min(1),
  }),
  body: z.object({
    slotIds: z.array(z.string().trim().min(1)).min(1),
    status: z.enum(["AVAILABLE", "BLOCKED"]),
  }),
});
