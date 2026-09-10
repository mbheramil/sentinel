/**
 * Assert that `src/index.ts` re-exports every Prisma enum explicitly, and that
 * nobody "simplifies" it back into a value wildcard.
 *
 * Background — the bug this exists to prevent shipped once and took the API down:
 *
 *   `export * from '@prisma/client'` type-checks perfectly and re-exports almost
 *   nothing at runtime. `packages/db` has no `"type": "module"`, so index.ts is
 *   transpiled to CJS; ESM consumers (`apps/api` and `apps/web` are both
 *   `"type": "module"`) therefore get its named exports from node's
 *   cjs-module-lexer, which scans the *emitted* file statically. A wildcard
 *   compiles to esbuild's `__reExport(exports, require(...))` — a runtime copy
 *   loop the lexer cannot see through — so the only visible binding was the
 *   literal `exports.prisma`. An explicit list compiles to esbuild's
 *   `__export(exports, { Prisma: () => ..., ... })` map, which the lexer does
 *   read. Hence: keep the list explicit.
 *
 * Verified empirically, both directions, importing @sentinel/db from apps/api:
 *   wildcard + `node --import tsx/esm` (production)  -> 2 keys, no `Prisma`
 *   wildcard + `tsx` CLI                             -> 17 keys, looks fine
 *   explicit + either loader                         -> 16 keys, correct
 *
 * That second line is why this check is a *source* check rather than a runtime
 * one. The `tsx` CLI registers the CJS require hook, so it loads index.ts as
 * CJS, `__reExport` actually runs, and the resulting object has every property —
 * a runtime `Object.keys()` assertion run under the CLI passes even when the bug
 * is present. (It was written that way first and cheerfully passed against the
 * reintroduced bug.) The matching runtime check lives in
 * `apps/api/scripts/check-db-exports.ts`, where it can use the production loader.
 *
 * The enum list is read from `$Enums` rather than hardcoded, so adding an enum to
 * schema.prisma fails this check until it is re-exported — which is the actual
 * maintenance hazard of an explicit list.
 */
import { $Enums } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `__dirname`, not `import.meta.url`: this package compiles to CommonJS (no
// `"type": "module"` — the very thing that causes the bug below), so `import.meta`
// is a compile error here. Resolving relative to this file rather than cwd keeps
// the check working however it is invoked.
const INDEX = join(__dirname, '..', 'src', 'index.ts');
const source = readFileSync(INDEX, 'utf8');

// A function declaration, not a `const` arrow: TypeScript only treats a
// `never`-returning call as terminating control flow when the callee is declared
// this way, and the narrowing of `block` below depends on it.
function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// `export type * from '@prisma/client'` is fine — types are erased, so the lexer
// never has to see them. A *value* wildcard is the bug.
if (/^\s*export\s+\*\s+from\s+['"]@prisma\/client['"]/m.test(source)) {
  fail(
    `packages/db/src/index.ts uses \`export * from '@prisma/client'\`.\n` +
      `  That re-exports nothing to ESM consumers at runtime and the type-checker\n` +
      `  cannot see the problem. Use an explicit \`export { ... }\` list instead;\n` +
      `  see the comment in index.ts.`,
  );
}

// The explicit block, e.g. `export {\n  Prisma,\n  ... \n} from '@prisma/client';`
const block = /export\s*\{([^}]*)\}\s*from\s*['"]@prisma\/client['"]/.exec(source);
if (!block?.[1]) {
  fail(
    `packages/db/src/index.ts has no \`export { ... } from '@prisma/client'\` block.\n` +
      `  ESM consumers need one; see the comment in index.ts.`,
  );
}

const exported = new Set(
  block[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // tolerate `X as Y` — what consumers see is the alias
    .map((s) => (s.includes(' as ') ? s.split(/\s+as\s+/)[1]!.trim() : s)),
);

if (Object.keys($Enums).length === 0) {
  fail('@prisma/client exposed no enums — did `prisma generate` run?');
}

const required = ['Prisma', 'PrismaClient', '$Enums', ...Object.keys($Enums)];
const missing = required.filter((k) => !exported.has(k));

if (missing.length > 0) {
  fail(
    `packages/db/src/index.ts does not re-export ${missing.length} required value(s):\n` +
      `  ${missing.join('\n  ')}\n\n` +
      `  Add them to the \`export { ... } from '@prisma/client'\` list in\n` +
      `  packages/db/src/index.ts. A wildcard re-export will NOT work here.`,
  );
}

if (!/^\s*export\s+const\s+prisma\b/m.test(source)) {
  fail('packages/db/src/index.ts no longer exports the `prisma` client singleton.');
}

console.log(`OK: index.ts explicitly re-exports all ${required.length} required values`);
console.log(`    ${required.join(', ')}`);
