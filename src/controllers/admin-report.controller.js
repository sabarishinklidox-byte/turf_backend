import { getAdminReports } from "../services/admin-report.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";

export const getAdminReportsOverview = asyncHandler(async (request, response) => {
  const result = await getAdminReports(request.query);

  sendSuccess(response, {
    data: result,
  });
});
