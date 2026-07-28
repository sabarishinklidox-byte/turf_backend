import { logger } from "../config/logger.js";

export const auditLog = (event) => {
  logger.info({ audit: true, ...event }, "Audit event");
};
