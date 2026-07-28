import { unlink } from "node:fs/promises";
import {
  checkOwnerAvailability,
  createTurf,
  getTurfById,
  listApprovedTurfs,
  listTurfs,
  setApprovedTurfActivation,
  updateApprovedTurf,
} from "../services/turf.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditLog } from "../utils/audit-log.js";
import { AppError } from "../utils/app-error.js";

const removeUploadedFiles = async (files = []) => {
  await Promise.allSettled(files.map((file) => unlink(file.path)));
};

export const checkTurfOwnerAvailability = asyncHandler(async (request, response) => {
  const availability = await checkOwnerAvailability(request.query);
  sendSuccess(response, { data: availability });
});

export const registerTurf = asyncHandler(async (request, response) => {
  const files = request.files ?? [];

  if (files.length === 0) {
    throw AppError.validation("Upload at least one turf image", {
      fieldErrors: { images: ["Upload at least one turf image"] },
    });
  }

  try {
    const imageUrls = files.map((file) => `/media/venues/${file.filename}`);
    const turf = await createTurf(request.body, imageUrls, request.user.id);

    auditLog({
      action: "turf.registered",
      actorId: request.user.id,
      resourceType: "Turf",
      resourceId: turf.id,
      metadata: { registrationNumber: turf.registrationNumber },
    });

    sendSuccess(response, {
      statusCode: 201,
      message: "Turf registered successfully",
      data: turf,
    });
  } catch (error) {
    await removeUploadedFiles(files);
    throw error;
  }
});

export const getTurfs = asyncHandler(async (request, response) => {
  const result = await listTurfs(request.query);
  sendSuccess(response, {
    data: result.items,
    meta: {
      metrics: result.metrics,
      pagination: result.pagination,
    },
  });
});

export const getTurf = asyncHandler(async (request, response) => {
  const turf = await getTurfById(request.params.turfId);
  sendSuccess(response, { data: turf });
});

export const getApprovedTurfs = asyncHandler(async (request, response) => {
  const result = await listApprovedTurfs(request.query);
  sendSuccess(response, {
    data: result.items,
    meta: { metrics: result.metrics, pagination: result.pagination },
  });
});

export const editApprovedTurf = asyncHandler(async (request, response) => {
  const turf = await updateApprovedTurf(request.params.turfId, request.body);
  auditLog({ action: "turf.updated", actorId: request.user.id, resourceType: "Turf", resourceId: turf.id });
  sendSuccess(response, { message: "Turf details updated", data: turf });
});

export const updateTurfActivation = asyncHandler(async (request, response) => {
  const turf = await setApprovedTurfActivation(request.params.turfId, request.body.isActive);
  auditLog({
    action: turf.isActive ? "turf.activated" : "turf.deactivated",
    actorId: request.user.id,
    resourceType: "Turf",
    resourceId: turf.id,
  });
  sendSuccess(response, {
    message: `Turf ${turf.isActive ? "activated" : "deactivated"}`,
    data: turf,
  });
});
