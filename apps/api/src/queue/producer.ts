import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedis } from '../lib/redis.js';
import { logger } from '../logger.js';

export interface RunJobPayload {
  runId: string;
  shardId: string;
  shardIndex: number;
  shardTotal: number;
  projectId: string;
  attempt: number;
}

let _queue: Queue<RunJobPayload> | null = null;

export function getQueue(): Queue<RunJobPayload> {
  if (!_queue) {
    // BullMQ requires maxRetriesPerRequest: null on the connection
    const connection = getRedis() as Redis;
    _queue = new Queue<RunJobPayload>('runs', {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    });
  }
  return _queue;
}

/**
 * Enqueue a single run shard for execution.
 * Uses a deterministic jobId so double-enqueuing the same shard is idempotent.
 */
export async function enqueueRun(
  runId: string,
  shardId: string,
  shardIndex: number,
  shardTotal: number,
  projectId: string,
): Promise<void> {
  const queue = getQueue();
  const jobId = `run_${runId}_shard_${shardIndex}`;
  const payload: RunJobPayload = { runId, shardId, shardIndex, shardTotal, projectId, attempt: 1 };

  await queue.add(jobId, payload, { jobId });
  logger.info({ runId, shardId, shardIndex, shardTotal, projectId }, 'Enqueued run shard');
}
