import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __deeptgPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.__deeptgPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__deeptgPrisma = prisma;
}
