import jwt from "jsonwebtoken";
import { AppError } from "../utils/app-error.js";

export const authenticate = (request, _response, next) => {
  const bearerToken = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice(7)
    : undefined;
  const token = bearerToken ?? request.cookies?.accessToken;

  if (!token) throw AppError.unauthorized();

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET ?? "");
    request.user = {
      id: payload.sub,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
    next();
  } catch {
    throw AppError.unauthorized("Access token is invalid or expired");
  }
};

export const authorize = (...requiredPermissions) =>
  (request, _response, next) => {
    if (!request.user) throw AppError.unauthorized();

    const missingPermissions = requiredPermissions.filter(
      (permission) => !request.user.permissions.includes(permission),
    );

    if (missingPermissions.length > 0) {
      throw AppError.forbidden("You do not have permission to perform this action");
    }

    next();
  };

export const authorizeRoles = (...requiredRoles) =>
  (request, _response, next) => {
    if (!request.user) throw AppError.unauthorized();

    const allowed = requiredRoles.some((role) => request.user.roles.includes(role));
    if (!allowed) {
      throw AppError.forbidden("You do not have access to this resource");
    }

    next();
  };
