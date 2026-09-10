import { z } from 'zod';
import { BrowserSchema } from './common.js';

export const RunStatusSchema = z.enum(['QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELED', 'ERROR', 'TIMED_OUT']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TestStatusSchema = z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'FLAKY', 'SKIPPED', 'TIMED_OUT']);
export type TestStatus = z.infer<typeof TestStatusSchema>;

export const RunTriggerSchema = z.enum(['MANUAL', 'SCHEDULE', 'API', 'CI', 'WEBHOOK', 'RETRY']);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

export const CreateRunSchema = z.object({
  suiteId: z.string().cuid().optional(),
  testCaseIds: z.array(z.string().cuid()).optional(),
  environmentId: z.string().cuid(),
  browsers: z.array(BrowserSchema).min(1).default(['CHROMIUM']),
  shardCount: z.number().int().min(1).max(10).default(1),
  traceMode: z.enum(['on', 'retain-on-failure', 'off']).default('retain-on-failure'),
  gitRef: z.string().optional(),
  gitSha: z.string().optional(),
}).refine((d) => d.suiteId ?? (d.testCaseIds && d.testCaseIds.length > 0), {
  message: 'Either suiteId or testCaseIds must be provided',
});

export const RunTotalsSchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  flaky: z.number(),
  skipped: z.number(),
  muted: z.number(),
  timedOut: z.number(),
});

export const TERMINAL_RUN_STATUSES: RunStatus[] = ['PASSED', 'FAILED', 'CANCELED', 'ERROR', 'TIMED_OUT'];
export const TERMINAL_TEST_STATUSES: TestStatus[] = ['PASSED', 'FAILED', 'FLAKY', 'SKIPPED', 'TIMED_OUT'];
