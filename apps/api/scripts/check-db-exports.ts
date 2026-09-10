/**
 * Import @sentinel/db exactly the way the running API imports it, and fail if a
 * binding the routes depend on is not actually there.
 *
 * This must be run as `node --import tsx/esm`, which is what pm2 runs the server
 * with (see infra/provision.sh). The loader is the whole point of the check:
 *
 *   `packages/db` is not `"type": "module"`, so its index.ts is transpiled to CJS,
 *   and this package *is* `"type": "module"`, so node hands us its named exports
 *   via cjs-module-lexer's static scan of the emitted file. When index.ts used
 *   `export * from '@prisma/client'` that scan found nothing but `prisma`, and the
 *   API crash-looped on boot with
 *     SyntaxError: The requested module '@sentinel/db' does not provide an export
 *     named 'Prisma'
 *   while `tsc --noEmit` was completely clean.
 *
 * Run under the `tsx` CLI instead, this check passes even when the bug is present
 * — the CLI's require hook loads index.ts as CJS, where the wildcard's runtime
 * copy loop really does populate the object. So the invocation in package.json is
 * load-bearing; don't "tidy" it to `tsx`.
 *
 * The named imports below are deliberate: a missing binding fails at link time
 * with the same SyntaxError production hit, before a line of this file runs.
 * `apps/api` cannot resolve `@prisma/client` itself (pnpm only links declared
 * dependencies), so the exhaustive-vs-schema half of this lives in
 * `packages/db/scripts/check-exports.ts`.
 */
import { $Enums, Prisma, PrismaClient, prisma } from '@sentinel/db';

const problems: string[] = [];

if (typeof prisma !== 'object' || prisma === null) {
  problems.push('`prisma` is not a client instance');
}
if (typeof PrismaClient !== 'function') {
  problems.push('`PrismaClient` is not a constructor');
}
// The specific member the API's nullable-Json writes depend on.
if (Prisma?.DbNull === undefined) {
  problems.push('`Prisma.DbNull` is unreachable (nullable-Json writes would break)');
}
if (typeof Prisma?.PrismaClientKnownRequestError !== 'function') {
  problems.push('`Prisma.PrismaClientKnownRequestError` is unreachable (error handling would break)');
}
if (!$Enums || Object.keys($Enums).length === 0) {
  problems.push('`$Enums` is empty — did `prisma generate` run?');
}

if (problems.length > 0) {
  console.error(
    `FAIL: @sentinel/db is not usable from an ESM consumer:\n  ${problems.join('\n  ')}\n\n` +
      `  Check the explicit \`export { ... } from '@prisma/client'\` list in\n` +
      `  packages/db/src/index.ts.`,
  );
  process.exit(1);
}

console.log('OK: @sentinel/db resolves under the production loader (node --import tsx/esm)');
