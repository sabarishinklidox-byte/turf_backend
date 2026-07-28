import { processRazorpayWebhook } from "../services/open-match-automation.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const handleRazorpayWebhook = asyncHandler(async (request, response) => {
  await processRazorpayWebhook({
    rawBody: request.body,
    signature: request.headers["x-razorpay-signature"],
  });

  response.status(200).json({ success: true });
});
