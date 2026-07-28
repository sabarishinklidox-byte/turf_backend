import { z } from "zod";

export const tournamentRegistrationOfferSettingsSchema = z.object({
  body: z.object({
    isEnabled: z.boolean(),
    discountPercent: z.coerce.number().int().min(1).max(100),
  }),
});

export const bookingPaymentGatewaySettingsSchema = z.object({
  body: z.object({
    isEnabled: z.boolean(),
    razorpayKeyId: z.string().trim().max(120).optional().default(""),
    razorpayKeySecret: z.string().trim().max(200).optional().default(""),
    razorpayWebhookSecret: z.string().trim().max(200).optional().default(""),
    razorpayXKeyId: z.string().trim().max(120).optional().default(""),
    razorpayXKeySecret: z.string().trim().max(200).optional().default(""),
    razorpayXSourceAccountNumber: z.string().trim().max(80).optional().default(""),
    autoRefundsEnabled: z.boolean().default(false),
    autoPayoutsEnabled: z.boolean().default(false),
    currency: z.string().trim().min(3).max(3).default("INR"),
  }),
});

export const cancellationPolicySettingsSchema = z.object({
  body: z
    .object({
      bookingFullRefundHours: z.coerce.number().int().min(0).max(168),
      bookingPartialRefundHours: z.coerce.number().int().min(0).max(168),
      bookingPartialRefundPercent: z.coerce.number().int().min(0).max(100),
      bookingNoRefundHours: z.coerce.number().int().min(0).max(168),
      openMatchFullRefundHours: z.coerce.number().int().min(0).max(168),
      openMatchPartialRefundHours: z.coerce.number().int().min(0).max(168),
      openMatchPartialRefundPercent: z.coerce.number().int().min(0).max(100),
      openMatchNoRefundHours: z.coerce.number().int().min(0).max(168),
    })
    .refine((value) => value.bookingFullRefundHours >= value.bookingPartialRefundHours, {
      message: "Booking full refund hours must be greater than or equal to partial refund hours",
      path: ["bookingFullRefundHours"],
    })
    .refine((value) => value.bookingPartialRefundHours >= value.bookingNoRefundHours, {
      message: "Booking partial refund hours must be greater than or equal to no-refund hours",
      path: ["bookingPartialRefundHours"],
    })
    .refine((value) => value.openMatchFullRefundHours >= value.openMatchPartialRefundHours, {
      message: "Host match full refund hours must be greater than or equal to partial refund hours",
      path: ["openMatchFullRefundHours"],
    })
    .refine((value) => value.openMatchPartialRefundHours >= value.openMatchNoRefundHours, {
      message: "Host match partial refund hours must be greater than or equal to no-refund hours",
      path: ["openMatchPartialRefundHours"],
    }),
});
