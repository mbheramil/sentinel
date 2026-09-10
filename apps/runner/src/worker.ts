import { Worker } from 'bullmq';
import { createRequire } from 'module';
import { config } from './config.js';
import { logger } from './logger.js';
import { processJob } from './claim.js';
import { PLAYWRIGHT_VERSION } from '@sentinel/shared';

// ── Startup version assertion ────────────────────────────────────────────────
// In local / dev mode we check that the locally resolved @playwright/test
// matches the pinned PLAYWRIGHT_VERSION.  In Docker mode the image tag is the
// source of truth; if the package can't be resolved here we skip the check.
try {
  const require = createRequire(import.meta.url);
  const pwPkg = require('@playwright/test/package.json') as { version: string };
  if (pwPkg.version !== PLAYWRIGHT_VERSION) {
    logger.fatal(
      { expected: PLAYWRIGHT_VERSION, actual: pwPkg.version },
      'Playwright version mismatch — rebuild the runner image or pin @playwright/test to the correct version',
    );
    process.exit(1);
  }
  logger.debug({ version: pwPkg.version }, '@playwright/test version verified');
} catch {
  // Package not installed in the runner process — Docker mode handles versioning
  // via the image tag (mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble).
  logger.debug(
    { expectedVersion: PLAYWRIGHT_VERSION },
    '@playwright/test not resolvable from runner process — assuming Docker mode',
  );
}

// ── BullMQ Worker ────────────────────────────────────────────────────────────
const worker = new Worker('runs', processJob, {
  connection: { url: config.REDIS_URL },
  concurrency: config.RUNNER_MAX_SLOTS,
});

worker.on('error', (err) => {
  logger.error({ err }, 'BullMQ worker error');
});

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, runId: job?.data?.runId, err },
    'BullMQ job failed',
  );
});

logger.info(
  {
    runnerId: config.RUNNER_ID,
    slots: config.RUNNER_MAX_SLOTS,
    strategy: config.SANDBOX_STRATEGY,
  },
  'Sentinel runner started',
);
