import { z } from "zod";

export const listAdminBookingsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(120).optional(),
    status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
    bookingType: z.enum(["DIRECT", "OPEN_MATCH"]).optional(),
    city: z.string().trim().max(80).optional(),
    turfId: z.string().trim().max(80).optional(),
  }),
});

export const listOpenMatchPaymentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    status: z
      .enum(["OPEN", "FILLING", "MIN_READY", "CONFIRMED_PARTIAL", "CONFIRMED_FULL", "CANCELLED", "CANCELLED_REFUND", "COMPLETED"])
      .optional(),
  }),
});

export const listDirectBookingPaymentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    status: z.enum(["CONFIRMED", "CANCELLED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"]).optional(),
  }),
});

export const releaseOpenMatchPayoutSchema = z.object({
  params: z.object({
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    payoutReference: z.string().trim().max(120).optional(),
  }),
});

export const cancelOpenMatchPaymentSchema = z.object({
  params: z.object({
    matchId: z.string().trim().min(1),
  }),
  body: z.object({
    reason: z.string().trim().min(5).max(240),
  }),
});

export const cancelDirectBookingPaymentSchema = z.object({
  params: z.object({
    bookingId: z.string().trim().min(1),
  }),
  body: z.object({
    reason: z.string().trim().min(5).max(240),
  }),
});
