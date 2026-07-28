import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";

export const healthCheck = asyncHandler(async (_request, response) => {
  sendSuccess(response, {
    message: "Turf API is healthy",
    data: { timestamp: new Date().toISOString() },
  });
});
