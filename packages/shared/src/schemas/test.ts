import { z } from 'zod';

export const AuthoringModeSchema = z.enum(['CODE', 'BUILDER', 'AI_GENERATED', 'RECORDED']);
export type AuthoringMode = z.infer<typeof AuthoringModeSchema>;

export const CreateTestCaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  filePath: z.string().min(1).max(500).regex(/^[a-zA-Z0-9_/.-]+\.spec\.ts$/, {
    message: 'File path must be a .spec.ts file with alphanumeric characters',
  }),
  code: z.string().min(1),
  stepsIr: z.unknown().optional(),
  authoringMode: AuthoringModeSchema.default('CODE'),
  tags: z.array(z.string()).default([]),
});

export const UpdateTestCaseSchema = CreateTestCaseSchema.partial().extend({
  isMuted: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export const CreateTestVersionSchema = z.object({
  code: z.string().min(1),
  stepsIr: z.unknown().optional(),
  message: z.string().optional(),
});

// Static analysis blocklist for user-supplied test code (§11.3)
export const BLOCKED_IMPORTS = [
  'child_process',
  'worker_threads',
  'vm',
  'net',
  'dgram',
] as const;

export const BLOCKED_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /require\s*\(\s*['"]worker_threads['"]\s*\)/,
  /require\s*\(\s*['"]vm['"]\s*\)/,
  /require\s*\(\s*['"]net['"]\s*\)/,
  /require\s*\(\s*['"]dgram['"]\s*\)/,
  /module\.constructor/,
] as const;

export const WARNED_PATTERNS = [
  { pattern: /waitForTimeout/, message: 'Prefer Playwright auto-waiting over waitForTimeout' },
  { pattern: /page\.\$(?!\$eval)/, message: 'Prefer page.locator() over page.$()' },
  { pattern: /nth-child/, message: 'Prefer getByRole/getByText over nth-child selectors' },
] as const;
