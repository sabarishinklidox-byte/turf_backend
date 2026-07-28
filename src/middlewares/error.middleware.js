import { MulterError } from "multer";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error.js";

const normalizeError = (error) => {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return AppError.validation("Request validation failed", error.flatten());
  }

  if (error instanceof MulterError) {
    return new AppError(error.message, 400, "UPLOAD_ERROR");
  }

  if (error?.code === "P2002") {
    return new AppError("A record with this value already exists", 409, "DUPLICATE_RECORD");
  }
  if (error?.code === "P2025") {
    return AppError.notFound("Requested record");
  }

  return new AppError("Internal server error", 500, "INTERNAL_ERROR", false);
};

export const errorHandler = (error, request, response, _next) => {
  const appError = normalizeError(error);

  request.log[appError.statusCode >= 500 ? "error" : "warn"](
    {
      error,
      statusCode: appError.statusCode,
      errorCode: appError.code,
      requestId: request.id,
    },
    appError.message,
  );

  response.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.isOperational ? appError.message : "Internal server error",
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
    requestId: request.id,
  });
};
