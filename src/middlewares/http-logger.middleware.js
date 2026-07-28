import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

export const httpLogger = pinoHttp({
  logger,
  genReqId: (request, response) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    response.setHeader("x-request-id", requestId);
    return requestId;
  },
  customLogLevel: (_request, response, error) => {
    if (error || response.statusCode >= 500) return "error";
    if (response.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (request, response) =>
    `${request.method} ${request.url} completed with ${response.statusCode}`,
  customErrorMessage: (request, response) =>
    `${request.method} ${request.url} failed with ${response.statusCode}`,
});
