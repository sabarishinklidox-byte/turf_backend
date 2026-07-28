import { Router } from "express";
import rateLimit from "express-rate-limit";
import { forgotPassword, login, logout, ownerSignup, refresh, resetPassword, userSignup } from "../controllers/auth.controller.js";
import { validate } from "../middlewares/validate.middleware.js";
import { forgotPasswordSchema, loginSchema, ownerSignupSchema, resetPasswordSchema, userSignupSchema } from "../schemas/auth.schema.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_LOGIN_ATTEMPTS",
      message: "Too many login attempts. Please try again later.",
    },
  },
});

router.post("/login", loginLimiter, validate(loginSchema), login);
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/signup", validate(userSignupSchema), userSignup);
router.post("/owner/signup", validate(ownerSignupSchema), ownerSignup);

export default router;
