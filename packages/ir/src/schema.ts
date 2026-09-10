import { z } from 'zod';

// ── ValueRef ─────────────────────────────────────────────────────────────────

export const ValueRefSchema = z.union([
  z.object({ literal: z.string() }),
  z.object({ var: z.string() }),
  z.object({ secret: z.string() }),
  z.object({ faker: z.string() }),
  z.object({ runToken: z.enum(['runId', 'runShortId', 'timestamp', 'testEmail']) }),
]);

// ── Target ────────────────────────────────────────────────────────────────────

const TargetBaseSchema = z.union([
  z.object({
    by: z.literal('role'),
    role: z.string(),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.object({
    by: z.enum(['label', 'placeholder', 'text', 'altText', 'title']),
    value: z.string(),
    exact: z.boolean().optional(),
  }),
  z.object({ by: z.literal('testId'), value: z.string() }),
  z.object({ by: z.enum(['css', 'xpath']), value: z.string() }),
]);

// Target is recursive: `frame` and `within` are also Targets
export const TargetSchema: z.ZodType = z.lazy(() =>
  TargetBaseSchema.and(
    z.object({
      nth: z.number().optional(),
      frame: TargetSchema.optional(),
      within: TargetSchema.optional(),
    }),
  ),
);

// ── Assertion ─────────────────────────────────────────────────────────────────

export const AssertionSchema: z.ZodType = z.lazy(() =>
  z.union([
    // State assertions on a target element
    z.object({
      on: TargetSchema,
      is: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'checked', 'editable', 'focused']),
      not: z.boolean().optional(),
    }),
    // Value assertions on a target element
    z.object({
      on: TargetSchema,
      is: z.enum(['text', 'containsText', 'value', 'attribute', 'class', 'count']),
      expected: ValueRefSchema,
      attribute: z.string().optional(),
      not: z.boolean().optional(),
    }),
    // Page-level assertions
    z.object({
      on: z.literal('page'),
      is: z.enum(['url', 'title']),
      expected: ValueRefSchema,
      not: z.boolean().optional(),
    }),
    // Response assertions
    z.object({
      on: z.literal('response'),
      is: z.enum(['status', 'ok', 'header', 'jsonPath']),
      urlPattern: z.string().optional(),
      path: z.string().optional(),
      header: z.string().optional(),
      expected: ValueRefSchema,
      not: z.boolean().optional(),
    }),
    // Console assertions
    z.object({
      on: z.literal('console'),
      is: z.enum(['noErrors', 'containsText']),
      expected: ValueRefSchema.optional(),
      ignorePatterns: z.array(z.string()).optional(),
    }),
    // Network assertions
    z.object({
      on: z.literal('network'),
      is: z.enum(['noFailedRequests', 'noStatusAtOrAbove']),
      expected: ValueRefSchema.optional(),
      ignorePatterns: z.array(z.string()).optional(),
    }),
    // Screenshot diff assertion
    z.object({
      on: TargetSchema,
      is: z.literal('screenshotMatches'),
      name: z.string(),
      maxDiffPixelRatio: z.number().optional(),
    }),
  ]),
);

// ── Step ──────────────────────────────────────────────────────────────────────

export const StepSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('goto'),
      url: z.string(),
      waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
      expectStatus: z.number().optional(),
    }),
    z.object({
      kind: z.literal('click'),
      target: TargetSchema,
      button: z.enum(['left', 'right', 'middle']).optional(),
      clickCount: z.number().optional(),
    }),
    z.object({
      kind: z.literal('fill'),
      target: TargetSchema,
      value: ValueRefSchema,
    }),
    z.object({
      kind: z.literal('type'),
      target: TargetSchema,
      value: ValueRefSchema,
      delayMs: z.number().optional(),
    }),
    z.object({
      kind: z.literal('press'),
      target: TargetSchema.optional(),
      key: z.string(),
    }),
    z.object({
      kind: z.literal('select'),
      target: TargetSchema,
      values: z.array(ValueRefSchema),
    }),
    z.object({
      kind: z.literal('check'),
      target: TargetSchema,
      checked: z.boolean(),
    }),
    z.object({
      kind: z.literal('upload'),
      target: TargetSchema,
      files: z.array(z.string()),
    }),
    z.object({
      kind: z.literal('hover'),
      target: TargetSchema,
    }),
    z.object({
      kind: z.literal('scrollTo'),
      target: TargetSchema,
    }),
    z.object({
      kind: z.literal('waitFor'),
      target: TargetSchema,
      state: z.enum(['visible', 'hidden', 'attached', 'detached']),
      timeoutMs: z.number().optional(),
    }),
    z.object({
      kind: z.literal('expect'),
      assertion: AssertionSchema,
    }),
    z.object({
      kind: z.literal('screenshot'),
      name: z.string(),
      fullPage: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('apiRequest'),
      method: z.string(),
      url: z.string(),
      body: z.unknown().optional(),
      saveAs: z.string().optional(),
    }),
    z.object({
      kind: z.literal('pollApi'),
      method: z.string(),
      url: z.string(),
      until: AssertionSchema,
      timeoutMs: z.number().optional(),
      intervalMs: z.number().optional(),
    }),
    z.object({
      kind: z.literal('waitForInbox'),
      provider: z.enum(['mailpit', 'mailosaur', 'imap']),
      to: ValueRefSchema,
      subjectContains: z.string().optional(),
      timeoutMs: z.number().optional(),
      saveAs: z.string().optional(),
    }),
    z.object({
      kind: z.literal('waitForCapture'),
      captureId: z.string(),
      matchBody: z.record(z.unknown()).optional(),
      timeoutMs: z.number().optional(),
      saveAs: z.string().optional(),
    }),
    z.object({
      kind: z.literal('group'),
      title: z.string(),
      steps: z.array(z.lazy(() => StepSchema)),
    }),
    z.object({
      kind: z.literal('comment'),
      text: z.string(),
    }),
    z.object({
      kind: z.literal('raw'),
      code: z.string(),
    }),
  ]),
);

export const StepIrSchema = z.object({
  version: z.literal(1),
  steps: z.array(StepSchema),
});
