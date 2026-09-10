import { Worker, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedis } from '../lib/redis.js';
import { runReaper } from '../services/retentionReaper.js';
import { runStatsReconciler } from '../services/statsReconciler.js';
import { logger } from '../logger.js';

const REAPER_QUEUE_NAME = 'retention-reaper';
const RECONCILER_QUEUE_NAME = 'stats-reconciler';

let _reaperQueue: Queue | null = null;
let _reconcilerQueue: Queue | null = null;

function getRetentionQueue(): Queue {
  if (!_reaperQueue) {
    _reaperQueue = new Queue(REAPER_QUEUE_NAME, {
      connection: getRedis() as Redis,
      defaultJobOptions: {
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      },
    });
  }
  return _reaperQueue;
}

function getReconcilerQueue(): Queue {
  if (!_reconcilerQueue) {
    _reconcilerQueue = new Queue(RECONCILER_QUEUE_NAME, {
      connection: getRedis() as Redis,
      defaultJobOptions: {
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      },
    });
  }
  return _reconcilerQueue;
}

/**
 * Register the daily retention reaper as a BullMQ repeatable job (cron: 0 3 * * *)
 * and start a Worker to process it.
 *
 * Safe to call multiple times — BullMQ deduplicates repeatable jobs by their pattern.
 */
export async function startRetentionReaper(): Promise<void> {
  const queue = getRetentionQueue();

  await queue.add(
    'daily-reaper',
    {},
    {
      repeat: { pattern: '0 3 * * *', utc: true },
      jobId: 'daily-reaper-repeatable',
    },
  );

  const worker = new Worker(
    REAPER_QUEUE_NAME,
    async (_job) => {
      logger.info('RetentionReaper: daily cycle starting');
      const result = await runReaper();
      logger.info(result, 'RetentionReaper: daily cycle finished');
    },
    {
      connection: getRedis() as Redis,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'RetentionReaper: job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'RetentionReaper: worker error');
  });

  logger.info({ cron: '0 3 * * *' }, 'RetentionReaper: scheduled (daily 03:00 UTC)');
}

/**
 * Register the nightly stats reconciler as a BullMQ repeatable job (cron: 0 4 * * *)
 * and start a Worker to process it.
 */
export async function startStatsReconciler(): Promise<void> {
  const queue = getReconcilerQueue();

  await queue.add(
    'daily-reconciler',
    {},
    {
      repeat: { pattern: '0 4 * * *', utc: true },
      jobId: 'daily-reconciler-repeatable',
    },
  );

  const worker = new Worker(
    RECONCILER_QUEUE_NAME,
    async (_job) => {
      logger.info('StatsReconciler: daily cycle starting');
      await runStatsReconciler();
    },
    {
      connection: getRedis() as Redis,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'StatsReconciler: job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'StatsReconciler: worker error');
  });

  logger.info({ cron: '0 4 * * *' }, 'StatsReconciler: scheduled (daily 04:00 UTC)');
}
