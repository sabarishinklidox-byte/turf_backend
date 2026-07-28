import { getOwnerVerification, listOwnerVerifications, reviewOwnerVerification } from "../services/admin-owner.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";

export const getOwnerVerifications = asyncHandler(async (request, response) => {
  const result = await listOwnerVerifications(request.query);
  sendSuccess(response, { data: result.items, meta: { metrics: result.metrics, pagination: result.pagination } });
});

export const getOwnerVerificationDetails = asyncHandler(async (request, response) => {
  sendSuccess(response, { data: await getOwnerVerification(request.params.ownerId) });
});

export const updateOwnerVerification = asyncHandler(async (request, response) => {
  const owner = await reviewOwnerVerification(request.params.ownerId, request.body, request.user.id);
  auditLog({ action: "turf-owner.verification.updated", actorId: request.user.id, resourceType: "User", resourceId: owner.id, metadata: { status: owner.status } });
  sendSuccess(response, { message: `Turf owner ${owner.status.toLowerCase()}`, data: owner });
});
