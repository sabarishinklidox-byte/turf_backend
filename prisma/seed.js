import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to seed the login user`);
  return value;
};

const databaseUrl = required("DATABASE_URL");
const email = required("SEED_USER_EMAIL").toLowerCase();
const password = required("SEED_USER_PASSWORD");
const firstName = required("SEED_USER_FIRST_NAME");
const lastName = process.env.SEED_USER_LAST_NAME?.trim() || null;
const roleName = process.env.SEED_USER_ROLE?.trim().toUpperCase() || "ADMIN";

if (password.length < 8 || password.length > 72) {
  throw new Error("SEED_USER_PASSWORD must contain between 8 and 72 characters");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: {
      name: roleName,
      description: `${roleName} platform role`,
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, firstName, lastName, isActive: true },
    create: { email, passwordHash, firstName, lastName },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  console.log(`Seeded ${email} with role ${roleName}`);
} finally {
  await prisma.$disconnect();
}
