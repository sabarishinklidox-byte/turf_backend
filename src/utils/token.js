import jwt from "jsonwebtoken";

const requiredSecret = (name) => {
  const value = process.env[name];
  if (!value || value.startsWith("replace-with-")) {
    throw new Error(`${name} must be configured`);
  }
  return value;
};

export const createAccessToken = (userId, payload = {}) =>
  jwt.sign(payload, requiredSecret("JWT_ACCESS_SECRET"), {
    subject: userId,
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  });

export const createRefreshToken = (userId) =>
  jwt.sign({}, requiredSecret("JWT_REFRESH_SECRET"), {
    subject: userId,
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  });

export const verifyRefreshToken = (token) =>
  jwt.verify(token, requiredSecret("JWT_REFRESH_SECRET"));
