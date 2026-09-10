import { prisma } from '@sentinel/db';
import { TERMINAL_RUN_STATUSES } from '@sentinel/shared';
import { enqueueRun } from './producer.js';
import { logger } from '../logger.js';

const HEARTBEAT_TIMEOUT_MS = 90_000; // 90 s — runner must heartbeat within this window
const REAPER_INTERVAL_MS = 60_000;  // check every 60 s

type RunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELED' | 'ERROR' | 'TIMED_OUT';

/** Mark orphaned shards (heartbeat stale) as ERROR and optionally re-enqueue them. */
async function reapOrphanedShards(): Promise<void> {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  const orphans = await prisma.runShard.findMany({
    where: {
      status: 'RUNNING',
      heartbeatAt: { lt: cutoff },
    },
    include: { run: { select: { projectId: true } } },
  });

  for (const shard of orphans) {
    logger.warn({ shardId: shard.id, runId: shard.runId, index: shard.index }, 'Reaping orphaned shard');

    await prisma.runShard.update({
      where: { id: shard.id },
      data: { status: 'ERROR', finishedAt: new Date() },
    });

    if (shard.attemptCount < 2) {
      try {
        await enqueueRun(shard.runId, shard.id, shard.index, shard.total, shard.run.projectId);
        // Reset the shard so the runner can claim it again
        await prisma.runShard.update({
          where: { id: shard.id },
          data: {
            status: 'QUEUED',
            attemptCount: { increment: 1 },
            claimedAt: null,
            heartbeatAt: null,
            runnerId: null,
            finishedAt: null,
          },
        });
        logger.info({ shardId: shard.id, runId: shard.runId }, 'Re-enqueued orphaned shard');
      } catch (err) {
        logger.error({ err, shardId: shard.id }, 'Failed to re-enqueue orphaned shard');
      }
    }
  }
}

/**
 * Find runs that are still RUNNING or QUEUED even though all their shards have
 * reached a terminal state, and fix their rollup status.
 */
async function fixStalledRuns(): Promise<void> {
  const activeRuns = await prisma.run.findMany({
    where: { status: { in: ['RUNNING', 'QUEUED'] } },
    include: { shards: { select: { status: true } } },
  });

  for (const run of activeRuns) {
    if (run.shards.length === 0) continue;

    const allTerminal = run.shards.every((s) =>
      TERMINAL_RUN_STATUSES.includes(s.status as (typeof TERMINAL_RUN_STATUSES)[number]),
    );
    if (!allTerminal) continue;

    const statuses = run.shards.map((s) => s.status);
    let finalStatus: RunStatus = 'PASSED';
    if (statuses.includes('ERROR')) finalStatus = 'ERROR';
    else if (statuses.includes('FAILED')) finalStatus = 'FAILED';
    else if (statuses.includes('CANCELED')) finalStatus = 'CANCELED';
    else if (statuses.includes('TIMED_OUT')) finalStatus = 'TIMED_OUT';

    await prisma.run.update({
      where: { id: run.id },
      data: { status: finalStatus, finishedAt: new Date() },
    });

    logger.info({ runId: run.id, finalStatus }, 'Fixed stalled run rollup');
  }
}

export function startReaper(): ReturnType<typeof setInterval> {
  logger.info({ intervalMs: REAPER_INTERVAL_MS }, 'Orphan reaper started');

  return setInterval(async () => {
    try {
      await reapOrphanedShards();
      await fixStalledRuns();
    } catch (err) {
      logger.error({ err }, 'Reaper cycle error');
    }
  }, REAPER_INTERVAL_MS);
}
