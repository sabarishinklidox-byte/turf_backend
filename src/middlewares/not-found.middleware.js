import { AppError } from "../utils/app-error.js";

export const notFoundHandler = (request, _response, next) => {
  next(new AppError(`Route ${request.method} ${request.originalUrl} not found`, 404, "ROUTE_NOT_FOUND"));
};
