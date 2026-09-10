import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  API_INTERNAL_URL: z.string().url().default('http://localhost:3001'),

  RUNNER_TOKEN: z.string().min(32, 'RUNNER_TOKEN must be at least 32 characters'),
  RUNNER_ID: z.string().default('runner-1'),
  RUNNER_MAX_SLOTS: z.coerce.number().int().min(1).default(2),

  SANDBOX_STRATEGY: z.enum(['docker', 'local']).default('docker'),

  PLAYWRIGHT_IMAGE: z.string().default('mcr.microsoft.com/playwright:v1.49.1-noble'),
  RUN_MAX_DURATION_MS: z.coerce.number().int().default(1800000),

  RUNNER_CPUS: z.string().default('1'),
  RUNNER_MEMORY: z.string().default('2g'),
  RUNNER_NETWORK: z.string().default('sentinel_runner'),

  ARTIFACT_MAX_BYTES: z.coerce.number().int().default(524288000),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

function loadConfig() {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    process.stderr.write(`\nSentinel Runner: configuration error\n${errors}\n`);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
