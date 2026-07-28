import { listAdminUsers } from "../services/admin-user.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";

export const getAdminUsers = asyncHandler(async (request, response) => {
  const result = await listAdminUsers(request.query);
  sendSuccess(response, {
    data: result.items,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});
