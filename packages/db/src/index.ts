import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const isDev = process.env['NODE_ENV'] === 'development';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev
      ? (['query', 'warn', 'error'] as const)
      : (['warn', 'error'] as const),
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
