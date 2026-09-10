import { PrismaClient } from '@prisma/client';

/**
 * Runtime (value) re-exports, listed explicitly. Do NOT collapse this into
 * `export * from '@prisma/client'` — that looks equivalent, type-checks
 * perfectly, and re-exports almost nothing at runtime.
 *
 * Why: this package has no `"type": "module"`, so index.ts is transpiled to CJS,
 * while its consumers (apps/api, apps/web) are both `"type": "module"`. Node
 * therefore derives our named exports with cjs-module-lexer, which scans the
 * *emitted* file statically. A wildcard compiles to esbuild's
 * `__reExport(exports, require('@prisma/client'))` — a runtime copy loop the
 * lexer cannot see through — so the only binding it found was the literal
 * `exports.prisma` below, and the API crash-looped on boot with
 * "does not provide an export named 'Prisma'". An explicit list compiles to
 * `__export(exports, { Prisma: () => ..., ... })`, which the lexer does read.
 *
 * No amount of type-checking catches this; the types are correct either way.
 * Note it is also invisible to the `tsx` CLI, which loads this file through its
 * CJS require hook so the copy loop really runs — the wildcard version looks
 * fine there and fails only under `node --import tsx/esm`, which is how pm2
 * starts the server. Both halves are guarded: see
 * packages/db/scripts/check-exports.ts and apps/api/scripts/check-db-exports.ts.
 *
 * If a new Prisma enum is added to the schema, add it here too.
 */
export {
  Prisma,
  PrismaClient,
  $Enums,
  ArtifactKind,
  AuthoringMode,
  Browser,
  IntegrationType,
  OverlapPolicy,
  Role,
  RunStatus,
  RunTrigger,
  SuiteMode,
  TaskKind,
  TestStatus,
} from '@prisma/client';

// Model and input types (Run, Test, Prisma.RunWhereInput, …) are type-only and
// erased at compile time, so a wildcard is safe for them.
export type * from '@prisma/client';

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
