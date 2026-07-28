import { prisma } from "../config/prisma.js";

const serializeUser = (user) => {
  const roleNames = user.roles?.map((item) => item.role.name) ?? [];
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: roleNames,
    roleLabel: roleNames.join(", "),
    bookingCount: user._count?.bookings ?? 0,
    venueCount: user._count?.ownedTurfs ?? 0,
    hostedMatchCount: user._count?.hostedOpenMatches ?? 0,
    ownerVerificationStatus: user.ownerVerification?.status ?? null,
  };
};

export const listAdminUsers = async ({ page, limit, search, role, status }) => {
  const where = {
    ...(status ? { isActive: status === "ACTIVE" } : {}),
    ...(role ? { roles: { some: { role: { name: role } } } } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [items, filteredTotal, total, active, inactive, players, owners, admins] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: {
        roles: { include: { role: true } },
        ownerVerification: true,
        _count: {
          select: {
            bookings: true,
            ownedTurfs: true,
            hostedOpenMatches: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { roles: { some: { role: { name: "USER" } } } } }),
    prisma.user.count({ where: { roles: { some: { role: { name: "TURF_OWNER" } } } } }),
    prisma.user.count({ where: { roles: { some: { role: { name: "ADMIN" } } } } }),
  ]);

  return {
    items: items.map(serializeUser),
    metrics: {
      total,
      active,
      inactive,
      players,
      owners,
      admins,
    },
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
    },
  };
};
