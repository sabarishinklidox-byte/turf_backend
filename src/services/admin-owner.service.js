import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

const serialize = (profile) => ({
  id: profile.user.id,
  verificationId: profile.id,
  firstName: profile.user.firstName,
  lastName: profile.user.lastName,
  fullName: [profile.user.firstName, profile.user.lastName].filter(Boolean).join(" "),
  email: profile.user.email,
  phone: profile.user.phone,
  status: profile.status,
  reviewNote: profile.reviewNote,
  submittedAt: profile.submittedAt,
  reviewedAt: profile.reviewedAt,
  venueCount: profile.user._count?.ownedTurfs ?? 0,
  venues:
    profile.user.ownedTurfs?.map((turf) => ({
      id: turf.id,
      turfName: turf.name,
      city: turf.city,
      state: turf.state,
      sports: turf.sports,
      status: turf.status,
      isActive: turf.isActive,
      registrationNumber: turf.registrationNumber,
      imageUrl: turf.imageUrls?.[0] ?? null,
    })) ?? [],
});

export const listOwnerVerifications = async ({ page, limit, search, status }) => {
  const where = {
    ...(status ? { status } : {}),
    ...(search ? { user: { OR: [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ] } } : {}),
  };
  const [items, filteredTotal, total, pending, approved, rejected] = await prisma.$transaction([
    prisma.turfOwnerVerification.findMany({ where, include: { user: { include: { _count: { select: { ownedTurfs: true } }, ownedTurfs: { orderBy: { createdAt: "desc" } } } } }, orderBy: { submittedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.turfOwnerVerification.count({ where }),
    prisma.turfOwnerVerification.count(),
    prisma.turfOwnerVerification.count({ where: { status: "PENDING" } }),
    prisma.turfOwnerVerification.count({ where: { status: "APPROVED" } }),
    prisma.turfOwnerVerification.count({ where: { status: "REJECTED" } }),
  ]);
  return { items: items.map(serialize), metrics: { total, pending, approved, rejected }, pagination: { page, limit, total: filteredTotal, totalPages: Math.max(1, Math.ceil(filteredTotal / limit)) } };
};

export const getOwnerVerification = async (ownerId) => {
  const profile = await prisma.turfOwnerVerification.findUnique({ where: { userId: ownerId }, include: { user: { include: { _count: { select: { ownedTurfs: true } }, ownedTurfs: { orderBy: { createdAt: "desc" } } } } } });
  if (!profile) throw AppError.notFound("Turf owner verification");
  return serialize(profile);
};

export const reviewOwnerVerification = async (ownerId, { status, note }, reviewedById) => {
  const profile = await prisma.turfOwnerVerification.findUnique({ where: { userId: ownerId } });
  if (!profile) throw AppError.notFound("Turf owner verification");
  const updated = await prisma.turfOwnerVerification.update({
    where: { userId: ownerId },
    data: { status, reviewNote: note || null, reviewedById, reviewedAt: new Date() },
    include: { user: { include: { _count: { select: { ownedTurfs: true } }, ownedTurfs: { orderBy: { createdAt: "desc" } } } } },
  });
  return serialize(updated);
};
