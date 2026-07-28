import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Enter a valid email address").transform((email) => email.toLowerCase()),
    password: z.string().min(8, "Password must contain at least 8 characters").max(72),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Enter a valid email address").transform((email) => email.toLowerCase()),
  }),
});

export const resetPasswordSchema = z.object({
  body: z
    .object({
      token: z.string().trim().min(20).max(300),
      password: z.string().min(8, "Password must contain at least 8 characters").max(72),
      confirmPassword: z.string().min(8).max(72),
    })
    .superRefine(({ password, confirmPassword }, context) => {
      if (password !== confirmPassword) {
        context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
      }
    }),
});

export const ownerSignupSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().max(60).optional().or(z.literal("")),
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    phone: z.string().trim().regex(/^[0-9]{10}$/),
    password: z.string().min(8).max(72),
  }),
});

export const userSignupSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().max(60).optional().or(z.literal("")),
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    phone: z.string().trim().regex(/^[0-9]{10}$/),
    password: z.string().min(8).max(72),
  }),
});
