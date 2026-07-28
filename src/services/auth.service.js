import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";
import { sendEmail } from "./email.service.js";
import { AppError } from "../utils/app-error.js";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-user-password", 12);
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const appBaseUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();

const hashResetToken = (token) => createHash("sha256").update(token).digest("hex");

const getRolesAndPermissions = (roleAssignments) => {
  const roles = roleAssignments.map(({ role }) => role.name);
  const permissions = [
    ...new Set(
      roleAssignments.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.key),
      ),
    ),
  ];

  return { roles, permissions };
};

export const loginWithEmail = async ({ email, password }) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      ownerVerification: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  const passwordMatches = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !user.passwordHash || !passwordMatches) {
    throw AppError.unauthorized("Email or password is incorrect");
  }

  if (!user.isActive) {
    throw AppError.forbidden("This account is inactive");
  }

  const { roles, permissions } = getRolesAndPermissions(user.roles);

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    latitude: user.latitude,
    longitude: user.longitude,
    roles,
    permissions,
    ownerVerificationStatus: user.ownerVerification?.status ?? null,
  };
};

export const getSessionUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      ownerVerification: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user || !user.isActive) throw AppError.unauthorized("Session is no longer valid");

  const { roles, permissions } = getRolesAndPermissions(user.roles);
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    latitude: user.latitude,
    longitude: user.longitude,
    roles,
    permissions,
    ownerVerificationStatus: user.ownerVerification?.status ?? null,
  };
};

export const signupTurfOwner = async ({ firstName, lastName, email, phone, password }) => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { email: true, phone: true },
  });
  if (existing?.email === email) throw AppError.conflict("An account already exists with this email");
  if (existing?.phone === phone) throw AppError.conflict("An account already exists with this phone number");

  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async (transaction) => {
    const role = await transaction.role.upsert({
      where: { name: "TURF_OWNER" },
      update: {},
      create: { name: "TURF_OWNER", description: "Turf owner platform role" },
    });
    const user = await transaction.user.create({
      data: {
        firstName,
        lastName: lastName || null,
        email,
        phone,
        passwordHash,
      },
    });
    await transaction.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await transaction.turfOwnerVerification.create({ data: { userId: user.id } });
    return { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName };
  });
};

export const signupUser = async ({ firstName, lastName, email, phone, password }) => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { email: true, phone: true },
  });
  if (existing?.email === email) throw AppError.conflict("An account already exists with this email");
  if (existing?.phone === phone) throw AppError.conflict("An account already exists with this phone number");

  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async (transaction) => {
    const role = await transaction.role.upsert({
      where: { name: "USER" },
      update: {},
      create: { name: "USER", description: "Player booking platform role" },
    });
    const user = await transaction.user.create({
      data: {
        firstName,
        lastName: lastName || null,
        email,
        phone,
        passwordHash,
      },
    });
    await transaction.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName };
  });
};

export const requestPasswordReset = async ({ email }) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      isActive: true,
      passwordHash: true,
    },
  });

  if (!user || !user.isActive || !user.passwordHash) {
    return { queued: false };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const resetUrl = `${appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    },
  });

  await sendEmail({
    to: user.email,
    subject: "Reset your PlayArena password",
    text: `Hi ${user.firstName},\n\nWe received a request to reset your password. Use this link to choose a new one:\n${resetUrl}\n\nThis link expires in 60 minutes. If you did not request this, you can ignore this email.\n\n- PlayArena`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10245e; line-height: 1.5;">
        <h2 style="margin-bottom: 8px;">Reset your password</h2>
        <p>Hi ${user.firstName},</p>
        <p>We received a request to reset your PlayArena password.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1646d8;color:#ffffff;text-decoration:none;font-weight:700;">
            Choose a new password
          </a>
        </p>
        <p style="margin-top: 16px;">This link expires in 60 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
        <p style="color:#5f6f92;">- PlayArena no-reply</p>
      </div>
    `,
  });

  return { queued: true };
};

export const resetPasswordWithToken = async ({ token, password }) => {
  const passwordResetTokenHash = hashResetToken(token);
  const user = await prisma.user.findFirst({
    where: {
      passwordResetTokenHash,
      passwordResetExpiresAt: { gt: new Date() },
      isActive: true,
    },
    select: { id: true },
  });

  if (!user) {
    throw AppError.validation("This reset link is invalid or expired");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });

  return { reset: true };
};
