import { z } from 'zod';

// NDJSON event types emitted by the sentinel-reporter
// Each event carries seq + ts + runId + shardIndex (§7.2)

const BaseEventSchema = z.object({
  seq: z.number().int(),
  ts: z.string().datetime(),
  runId: z.string(),
  shardIndex: z.number().int(),
});

export const RunBeginEventSchema = BaseEventSchema.extend({
  type: z.literal('run.begin'),
  payload: z.object({
    totalTests: z.number().int(),
    workers: z.number().int(),
    playwrightVersion: z.string(),
  }),
});

export const TestBeginEventSchema = BaseEventSchema.extend({
  type: z.literal('test.begin'),
  payload: z.object({
    testId: z.string(),
    title: z.string(),
    filePath: z.string(),
    projectLabel: z.string(),
    attemptIndex: z.number().int(),
  }),
});

export const StepBeginEventSchema = BaseEventSchema.extend({
  type: z.literal('step.begin'),
  payload: z.object({
    testId: z.string(),
    attemptIndex: z.number().int(),
    stepId: z.string(),
    parentStepId: z.string().nullable(),
    title: z.string(),
    category: z.string(),
  }),
});

export const StepEndEventSchema = BaseEventSchema.extend({
  type: z.literal('step.end'),
  payload: z.object({
    testId: z.string(),
    attemptIndex: z.number().int(),
    stepId: z.string(),
    status: z.string(),
    durationMs: z.number().int().nullable(),
    error: z.string().nullable(),
  }),
});

export const TestStdoutEventSchema = BaseEventSchema.extend({
  type: z.literal('test.stdout'),
  payload: z.object({
    testId: z.string(),
    attemptIndex: z.number().int(),
    chunk: z.string(),
    truncated: z.boolean().optional(),
  }),
});

export const TestStderrEventSchema = BaseEventSchema.extend({
  type: z.literal('test.stderr'),
  payload: z.object({
    testId: z.string(),
    attemptIndex: z.number().int(),
    chunk: z.string(),
    truncated: z.boolean().optional(),
  }),
});

export const TestEndEventSchema = BaseEventSchema.extend({
  type: z.literal('test.end'),
  payload: z.object({
    testId: z.string(),
    attemptIndex: z.number().int(),
    status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
    durationMs: z.number().int(),
    error: z.object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
      snippet: z.string().optional(),
      expected: z.string().optional(),
      actual: z.string().optional(),
    }).nullable(),
    attachments: z.array(z.object({
      name: z.string(),
      contentType: z.string(),
      path: z.string().optional(),
    })),
  }),
});

export const RunEndEventSchema = BaseEventSchema.extend({
  type: z.literal('run.end'),
  payload: z.object({
    status: z.string(),
    durationMs: z.number().int(),
  }),
});

export const SentinelEventSchema = z.discriminatedUnion('type', [
  RunBeginEventSchema,
  TestBeginEventSchema,
  StepBeginEventSchema,
  StepEndEventSchema,
  TestStdoutEventSchema,
  TestStderrEventSchema,
  TestEndEventSchema,
  RunEndEventSchema,
]);

export type SentinelEvent = z.infer<typeof SentinelEventSchema>;
