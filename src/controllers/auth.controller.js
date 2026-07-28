import { getSessionUser, loginWithEmail, requestPasswordReset, resetPasswordWithToken, signupTurfOwner, signupUser } from "../services/auth.service.js";
import { AppError } from "../utils/app-error.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";
import { createAccessToken, createRefreshToken, verifyRefreshToken } from "../utils/token.js";

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/api/v1/auth",
};

const clearRefreshCookieOptions = {
  httpOnly: refreshCookieOptions.httpOnly,
  secure: refreshCookieOptions.secure,
  sameSite: refreshCookieOptions.sameSite,
  path: refreshCookieOptions.path,
};

const createSessionPayload = (user) => {
  const tokenPayload = {
    roles: user.roles,
    permissions: user.permissions,
  };
  return {
    user,
    accessToken: createAccessToken(user.id, tokenPayload),
  };
};

export const login = asyncHandler(async (request, response) => {
  const user = await loginWithEmail(request.body);
  const refreshToken = createRefreshToken(user.id);

  response.cookie("refreshToken", refreshToken, refreshCookieOptions);

  auditLog({
    action: "auth.login.succeeded",
    actorId: user.id,
    resourceType: "User",
    resourceId: user.id,
  });

  sendSuccess(response, {
    message: "Login successful",
    data: createSessionPayload(user),
  });
});

export const refresh = asyncHandler(async (request, response) => {
  const refreshToken = request.cookies?.refreshToken;
  if (!refreshToken) throw AppError.unauthorized("Refresh session is missing");

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    response.clearCookie("refreshToken", clearRefreshCookieOptions);
    throw AppError.unauthorized("Refresh session is invalid or expired");
  }

  const user = await getSessionUser(payload.sub);
  const rotatedRefreshToken = createRefreshToken(user.id);
  response.cookie("refreshToken", rotatedRefreshToken, refreshCookieOptions);
  sendSuccess(response, { message: "Session refreshed", data: createSessionPayload(user) });
});

export const logout = asyncHandler(async (_request, response) => {
  response.clearCookie("refreshToken", clearRefreshCookieOptions);
  sendSuccess(response, { message: "Logged out" });
});

export const forgotPassword = asyncHandler(async (request, response) => {
  await requestPasswordReset(request.body);
  sendSuccess(response, {
    message: "If that email exists, a password reset link has been sent",
  });
});

export const resetPassword = asyncHandler(async (request, response) => {
  await resetPasswordWithToken(request.body);
  sendSuccess(response, { message: "Password reset successful" });
});

export const ownerSignup = asyncHandler(async (request, response) => {
  const user = await signupTurfOwner(request.body);
  auditLog({ action: "auth.turf-owner.signed-up", actorId: user.id, resourceType: "User", resourceId: user.id });
  sendSuccess(response, { statusCode: 201, message: "Registration submitted for admin verification", data: { user } });
});

export const userSignup = asyncHandler(async (request, response) => {
  const user = await signupUser(request.body);
  auditLog({ action: "auth.user.signed-up", actorId: user.id, resourceType: "User", resourceId: user.id });
  sendSuccess(response, { statusCode: 201, message: "Account created successfully", data: { user } });
});
