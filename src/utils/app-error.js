export class AppError extends Error {
  constructor(
    message,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    isOperational = true,
    details,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static validation(message, details) {
    return new AppError(message, 422, "VALIDATION_ERROR", true, details);
  }

  static unauthorized(message = "Authentication is required") {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message = "You are not allowed to perform this action") {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static notFound(resource = "Resource") {
    return new AppError(`${resource} not found`, 404, "NOT_FOUND");
  }

  static conflict(message) {
    return new AppError(message, 409, "CONFLICT");
  }
}
