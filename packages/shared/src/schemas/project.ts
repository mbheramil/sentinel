import { z } from 'zod';
import { BrowserSchema } from './common.js';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens',
  }),
  description: z.string().optional(),
  defaultBrowsers: z.array(BrowserSchema).min(1).default(['CHROMIUM']),
  defaultTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
  defaultRetries: z.number().int().min(0).max(5).default(1),
  defaultExpectTimeoutMs: z.number().int().min(500).max(30000).default(5000),
  concurrency: z.number().int().min(1).max(20).default(2),
  artifactRetentionDays: z.number().int().min(1).max(365).default(30),
  failOnConsoleError: z.boolean().default(false),
  failOnNetworkError: z.boolean().default(false),
  diagnosticsIgnore: z.array(z.string()).default([]),
  testDataPrefix: z.string().default('[SENTINEL TEST]'),
  testEmailLocal: z.string().optional(),
  testEmailDomain: z.string().optional(),
});

export const CreateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  isDefault: z.boolean().default(false),
  variables: z.record(z.string()).default({}),
  secrets: z.record(z.string()).optional(),
  httpCredentials: z.object({ username: z.string(), password: z.string() }).optional(),
});
