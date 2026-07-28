import { z } from "zod";

const turfStatuses = [
  "PENDING_REVIEW",
  "DOCUMENTS_VERIFIED",
  "ACTION_REQUIRED",
  "APPROVED",
  "REJECTED",
];

const jsonArray = (fieldName) =>
  z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, z.array(z.string().trim().min(1)).min(1, `Select at least one ${fieldName}`));

const optionalCoordinate = (min, max) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().min(min).max(max).optional(),
  );

export const createTurfSchema = z.object({
  body: z.object({
    turfName: z.string().trim().min(3).max(120),
    ownerName: z.string().trim().min(3).max(100),
    ownerEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
    ownerPhone: z.string().trim().regex(/^[0-9]{10}$/),
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
    bookingCancellationOverrideEnabled: z.preprocess((value) => value === true || value === "true", z.boolean()).optional().default(false),
    bookingCancellationFullRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    bookingCancellationPartialRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    bookingCancellationPartialRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    bookingCancellationNoRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationOverrideEnabled: z.preprocess((value) => value === true || value === "true", z.boolean()).optional().default(false),
    openMatchCancellationFullRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationPartialRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationPartialRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    openMatchCancellationNoRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    termsAccepted: z.preprocess(
      (value) => value === true || value === "true",
      z.literal(true),
    ),
  }),
});

export const listTurfsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(100).default(""),
    status: z.enum(turfStatuses).optional(),
  }),
});

export const checkOwnerAvailabilitySchema = z.object({
  query: z
    .object({
      email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
      phone: z.string().trim().regex(/^[0-9]{10}$/).optional(),
    })
    .refine(({ email, phone }) => email || phone, {
      message: "Email or phone is required",
    }),
});

export const turfIdSchema = z.object({
  params: z.object({
    turfId: z.string().trim().min(1),
  }),
});

export const listApprovedTurfsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(100).default(""),
    active: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  }),
});

export const updateTurfSchema = z.object({
  params: z.object({
    turfId: z.string().trim().min(1),
  }),
  body: z.object({
    turfName: z.string().trim().min(3).max(120),
    ownerName: z.string().trim().min(3).max(100),
    ownerEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
    ownerPhone: z.string().trim().regex(/^[0-9]{10}$/),
    description: z.string().trim().min(20).max(2000),
    address: z.string().trim().min(8).max(300),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().regex(/^[0-9]{6}$/),
    landmark: z.string().trim().max(120).optional().or(z.literal("")),
    latitude: optionalCoordinate(-90, 90),
    longitude: optionalCoordinate(-180, 180),
    sports: z.array(z.string().trim().min(1)).min(1),
    surfaceType: z.string().trim().min(1).max(80),
    openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    amenities: z.array(z.string().trim().min(1)).min(1),
    bookingCancellationOverrideEnabled: z.coerce.boolean().optional(),
    bookingCancellationFullRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    bookingCancellationPartialRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    bookingCancellationPartialRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    bookingCancellationNoRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationOverrideEnabled: z.coerce.boolean().optional(),
    openMatchCancellationFullRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationPartialRefundHours: z.coerce.number().int().min(0).max(168).optional(),
    openMatchCancellationPartialRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    openMatchCancellationNoRefundHours: z.coerce.number().int().min(0).max(168).optional(),
  }),
});

export const updateTurfActivationSchema = z.object({
  params: z.object({
    turfId: z.string().trim().min(1),
  }),
  body: z.object({
    isActive: z.boolean(),
  }),
});
