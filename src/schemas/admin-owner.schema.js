import { z } from "zod";

export const listOwnerVerificationsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(100).default(""),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  }),
});

export const ownerVerificationIdSchema = z.object({
  params: z.object({ ownerId: z.string().trim().min(1) }),
});

export const reviewOwnerVerificationSchema = z.object({
  params: z.object({ ownerId: z.string().trim().min(1) }),
  body: z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().max(1000).default(""),
  }).superRefine(({ status, note }, context) => {
    if (status === "REJECTED" && note.length < 10) {
      context.addIssue({ code: "custom", path: ["note"], message: "Add a rejection reason of at least 10 characters" });
    }
  }),
});
