import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";
import { resolveCoordinatesFromAddress } from "./location.service.js";

const statusLabels = {
  PENDING_REVIEW: "Pending Review",
  DOCUMENTS_VERIFIED: "Documents Verified",
  ACTION_REQUIRED: "Action Required",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const serializeTurf = (turf) => ({
  id: turf.id,
  registrationNumber: turf.registrationNumber,
  turfName: turf.name,
  ownerName: turf.ownerName,
  ownerEmail: turf.ownerEmail,
  ownerPhone: turf.ownerPhone,
  description: turf.description,
  address: turf.address,
  city: turf.city,
  state: turf.state,
  postalCode: turf.postalCode,
  landmark: turf.landmark,
  latitude: turf.latitude,
  longitude: turf.longitude,
  sports: turf.sports,
  surfaceType: turf.surfaceType,
  pricePerHour: turf.pricePerHour,
  openingTime: turf.openingTime,
  closingTime: turf.closingTime,
  amenities: turf.amenities,
  imageUrls: turf.imageUrls,
  bookingCancellationOverrideEnabled: turf.bookingCancellationOverrideEnabled,
  bookingCancellationFullRefundHours: turf.bookingCancellationFullRefundHours ?? null,
  bookingCancellationPartialRefundHours: turf.bookingCancellationPartialRefundHours ?? null,
  bookingCancellationPartialRefundPercent: turf.bookingCancellationPartialRefundPercent ?? null,
  bookingCancellationNoRefundHours: turf.bookingCancellationNoRefundHours ?? null,
  openMatchCancellationOverrideEnabled: turf.openMatchCancellationOverrideEnabled,
  openMatchCancellationFullRefundHours: turf.openMatchCancellationFullRefundHours ?? null,
  openMatchCancellationPartialRefundHours: turf.openMatchCancellationPartialRefundHours ?? null,
  openMatchCancellationPartialRefundPercent: turf.openMatchCancellationPartialRefundPercent ?? null,
  openMatchCancellationNoRefundHours: turf.openMatchCancellationNoRefundHours ?? null,
  status: turf.status,
  statusLabel: statusLabels[turf.status],
  isActive: turf.isActive,
  documentCount: turf.documentCount,
  reviewNote: turf.reviewNote,
  reviewedById: turf.reviewedById,
  reviewedAt: turf.reviewedAt,
  ownerUserId: turf.ownerUserId,
  createdAt: turf.createdAt,
  updatedAt: turf.updatedAt,
});

const buildRegistrationNumber = () => {
  const year = new Date().getFullYear();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `TF-${year}-${suffix}`;
};

const coordinatesFromInput = async (input) => {
  const resolved = await resolveCoordinatesFromAddress(input);
  return {
    latitude: resolved?.latitude ?? input.latitude ?? null,
    longitude: resolved?.longitude ?? input.longitude ?? null,
  };
};

export const checkOwnerAvailability = async ({ email, phone }) => {
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedPhone = phone?.trim();
  const conflicts = await prisma.turf.findMany({
    where: {
      OR: [
        ...(normalizedEmail
          ? [{ ownerEmail: { equals: normalizedEmail, mode: "insensitive" } }]
          : []),
        ...(normalizedPhone ? [{ ownerPhone: normalizedPhone }] : []),
      ],
    },
    select: { ownerEmail: true, ownerPhone: true },
  });

  return {
    emailAvailable:
      !normalizedEmail ||
      !conflicts.some(
        (item) => item.ownerEmail.toLowerCase() === normalizedEmail,
      ),
    phoneAvailable:
      !normalizedPhone ||
      !conflicts.some((item) => item.ownerPhone === normalizedPhone),
  };
};

export const createTurf = async (input, imageUrls, createdById) => {
  const normalizedEmail = input.ownerEmail.trim().toLowerCase();
  const normalizedPhone = input.ownerPhone.trim();
  const availability = await checkOwnerAvailability({
    email: normalizedEmail,
    phone: normalizedPhone,
  });

  if (!availability.emailAvailable) {
    throw new AppError(
      "This owner email is already registered",
      409,
      "OWNER_EMAIL_EXISTS",
      true,
      { field: "ownerEmail" },
    );
  }

  if (!availability.phoneAvailable) {
    throw new AppError(
      "This owner phone number is already registered",
      409,
      "OWNER_PHONE_EXISTS",
      true,
      { field: "ownerPhone" },
    );
  }

  let turf;
  try {
    const coordinates = await coordinatesFromInput(input);
    turf = await prisma.turf.create({
      data: {
        registrationNumber: buildRegistrationNumber(),
        name: input.turfName,
        ownerName: input.ownerName,
        ownerEmail: normalizedEmail,
        ownerPhone: normalizedPhone,
        description: input.description,
        address: input.address,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        landmark: input.landmark || null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        sports: input.sports,
        surfaceType: input.surfaceType,
        pricePerHour: null,
        openingTime: input.openingTime,
        closingTime: input.closingTime,
        amenities: input.amenities,
        imageUrls,
        bookingCancellationOverrideEnabled: Boolean(input.bookingCancellationOverrideEnabled),
        bookingCancellationFullRefundHours: input.bookingCancellationFullRefundHours ?? null,
        bookingCancellationPartialRefundHours: input.bookingCancellationPartialRefundHours ?? null,
        bookingCancellationPartialRefundPercent: input.bookingCancellationPartialRefundPercent ?? null,
        bookingCancellationNoRefundHours: input.bookingCancellationNoRefundHours ?? null,
        openMatchCancellationOverrideEnabled: Boolean(input.openMatchCancellationOverrideEnabled),
        openMatchCancellationFullRefundHours: input.openMatchCancellationFullRefundHours ?? null,
        openMatchCancellationPartialRefundHours: input.openMatchCancellationPartialRefundHours ?? null,
        openMatchCancellationPartialRefundPercent: input.openMatchCancellationPartialRefundPercent ?? null,
        openMatchCancellationNoRefundHours: input.openMatchCancellationNoRefundHours ?? null,
        createdById,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(" ")
        : String(error.meta?.target ?? "");
      if (target.includes("ownerEmail")) {
        throw new AppError(
          "This owner email is already registered",
          409,
          "OWNER_EMAIL_EXISTS",
          true,
          { field: "ownerEmail" },
        );
      }
      if (target.includes("ownerPhone")) {
        throw new AppError(
          "This owner phone number is already registered",
          409,
          "OWNER_PHONE_EXISTS",
          true,
          { field: "ownerPhone" },
        );
      }
    }
    throw error;
  }

  return serializeTurf(turf);
};

export const getTurfById = async (turfId) => {
  const turf = await prisma.turf.findUnique({ where: { id: turfId } });
  if (!turf) throw AppError.notFound("Turf application");
  return serializeTurf(turf);
};

const approvedTurfOrThrow = async (turfId) => {
  const turf = await prisma.turf.findUnique({ where: { id: turfId } });
  if (!turf) throw AppError.notFound("Turf");
  if (turf.status !== "APPROVED") {
    throw AppError.conflict("Only approved turfs can be managed");
  }
  return turf;
};

export const listApprovedTurfs = async ({ page, limit, search, active }) => {
  const where = {
    status: "APPROVED",
    ...(active === undefined ? {} : { isActive: active }),
    ...(search
      ? {
          OR: [
            { registrationNumber: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { ownerName: { contains: search, mode: "insensitive" } },
            { ownerEmail: { contains: search, mode: "insensitive" } },
            { ownerPhone: { contains: search } },
            { city: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, filteredTotal, total, activeCount, inactiveCount] =
    await prisma.$transaction([
      prisma.turf.findMany({
        where,
        orderBy: { approvedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.turf.count({ where }),
      prisma.turf.count({ where: { status: "APPROVED" } }),
      prisma.turf.count({ where: { status: "APPROVED", isActive: true } }),
      prisma.turf.count({ where: { status: "APPROVED", isActive: false } }),
    ]);

  return {
    items: items.map(serializeTurf),
    metrics: { total, active: activeCount, inactive: inactiveCount },
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
    },
  };
};

export const updateApprovedTurf = async (turfId, input) => {
  const currentTurf = await approvedTurfOrThrow(turfId);
  const normalizedEmail = input.ownerEmail.trim().toLowerCase();
  const normalizedPhone = input.ownerPhone.trim();
  const coordinates = await coordinatesFromInput(input);
  const latitude = coordinates.latitude ?? currentTurf.latitude ?? null;
  const longitude = coordinates.longitude ?? currentTurf.longitude ?? null;
  const turf = await prisma.turf.update({
    where: { id: turfId },
    data: {
      name: input.turfName,
      ownerName: input.ownerName,
      ownerEmail: normalizedEmail,
      ownerPhone: normalizedPhone,
      description: input.description,
      address: input.address,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      landmark: input.landmark || null,
      latitude,
      longitude,
      sports: input.sports,
      surfaceType: input.surfaceType,
      openingTime: input.openingTime,
      closingTime: input.closingTime,
      amenities: input.amenities,
      bookingCancellationOverrideEnabled: Boolean(input.bookingCancellationOverrideEnabled),
      bookingCancellationFullRefundHours: input.bookingCancellationFullRefundHours ?? null,
      bookingCancellationPartialRefundHours: input.bookingCancellationPartialRefundHours ?? null,
      bookingCancellationPartialRefundPercent: input.bookingCancellationPartialRefundPercent ?? null,
      bookingCancellationNoRefundHours: input.bookingCancellationNoRefundHours ?? null,
      openMatchCancellationOverrideEnabled: Boolean(input.openMatchCancellationOverrideEnabled),
      openMatchCancellationFullRefundHours: input.openMatchCancellationFullRefundHours ?? null,
      openMatchCancellationPartialRefundHours: input.openMatchCancellationPartialRefundHours ?? null,
      openMatchCancellationPartialRefundPercent: input.openMatchCancellationPartialRefundPercent ?? null,
      openMatchCancellationNoRefundHours: input.openMatchCancellationNoRefundHours ?? null,
    },
  });
  return serializeTurf(turf);
};

export const setApprovedTurfActivation = async (turfId, isActive) => {
  await approvedTurfOrThrow(turfId);
  const turf = await prisma.turf.update({
    where: { id: turfId },
    data: { isActive },
  });
  return serializeTurf(turf);
};

export const listTurfs = async ({ page, limit, search, status }) => {
  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { registrationNumber: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { ownerName: { contains: search, mode: "insensitive" } },
            { ownerEmail: { contains: search, mode: "insensitive" } },
            { ownerPhone: { contains: search } },
            { city: { contains: search, mode: "insensitive" } },
            { state: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [items, filteredTotal, total, pending, verified, approvedThisMonth] =
    await prisma.$transaction([
      prisma.turf.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.turf.count({ where }),
      prisma.turf.count(),
      prisma.turf.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.turf.count({ where: { status: "DOCUMENTS_VERIFIED" } }),
      prisma.turf.count({
        where: { status: "APPROVED", approvedAt: { gte: startOfMonth } },
      }),
    ]);

  return {
    items: items.map(serializeTurf),
    metrics: {
      total,
      pending,
      verified,
      approvedThisMonth,
    },
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
      hasNextPage: page * limit < filteredTotal,
      hasPreviousPage: page > 1,
    },
  };
};
