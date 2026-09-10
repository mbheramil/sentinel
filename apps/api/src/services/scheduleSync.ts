import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { prisma, type Browser } from '@sentinel/db';
import { getRedis } from '../lib/redis.js';
import { logger } from '../logger.js';
import { enqueueRun } from '../queue/producer.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ScheduleJobData {
  scheduleId: string;
}

interface ScheduleRecord {
  id: string;
  projectId: string;
  suiteId: string | null;
  taskId: string | null;
  environmentId: string;
  name: string;
  cron: string;
  timezone: string;
  browsers: Browser[];
  isEnabled: boolean;
  overlapPolicy: string;
}

// ─── Queue singleton ────────────────────────────────────────────────────────

let _scheduleQueue: Queue<ScheduleJobData> | null = null;

function getScheduleQueue(): Queue<ScheduleJobData> {
  if (!_scheduleQueue) {
    const connection = getRedis() as Redis;
    _scheduleQueue = new Queue<ScheduleJobData>('sentinel-schedules', {
      connection,
      defaultJobOptions: {
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    });
  }
  return _scheduleQueue;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

let _worker: Worker<ScheduleJobData> | null = null;

async function processScheduleJob(job: Job<ScheduleJobData>): Promise<void> {
  const { scheduleId } = job.data;

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      suite: {
        include: {
          items: { select: { testCaseId: true }, orderBy: { position: 'asc' } },
        },
      },
    },
  });

  if (!schedule || !schedule.isEnabled) {
    logger.info({ scheduleId }, 'Schedule disabled or not found — skipping');
    return;
  }

  // Respect overlapPolicy
  if (schedule.overlapPolicy === 'SKIP') {
    const running = await prisma.run.findFirst({
      where: {
        projectId: schedule.projectId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    });
    if (running) {
      logger.info({ scheduleId, runningRunId: running.id }, 'Overlap policy SKIP — run already active');
      return;
    }
  }

  // Resolve test case IDs
  let testCaseIds: string[] = [];
  if (schedule.suiteId && schedule.suite) {
    testCaseIds = schedule.suite.items.map((i) => i.testCaseId);
  } else if (schedule.taskId) {
    // taskId == '__all__' means run every non-archived test in the project.
    // Any other taskId value is treated as a single test case ID.
    if (schedule.taskId === '__all__') {
      const all = await prisma.testCase.findMany({
        where: { projectId: schedule.projectId, isArchived: false },
        select: { id: true },
      });
      testCaseIds = all.map((t) => t.id);
    } else {
      testCaseIds = [schedule.taskId];
    }
  }

  if (testCaseIds.length === 0) {
    logger.warn({ scheduleId }, 'No test cases to run for schedule');
    return;
  }

  // Fetch active test cases with current version
  const testCases = await prisma.testCase.findMany({
    where: { id: { in: testCaseIds }, projectId: schedule.projectId, isArchived: false },
    select: { id: true, currentVersionId: true },
  });

  const validTests = testCases.filter((tc) => tc.currentVersionId !== null);
  if (validTests.length === 0) {
    logger.warn({ scheduleId }, 'No valid (non-archived, versioned) test cases for schedule');
    return;
  }

  // Stored as Json in the schema, but the values are always Prisma `Browser`
  // enum members — validated on write by the schedule create/update routes.
  const browsers = schedule.browsers as Browser[];

  const run = await prisma.$transaction(async (tx) => {
    const r = await tx.run.create({
      data: {
        projectId: schedule.projectId,
        suiteId: schedule.suiteId ?? undefined,
        environmentId: schedule.environmentId,
        trigger: 'SCHEDULE',
        browsers,
        shardCount: 1,
        traceMode: 'retain-on-failure',
      },
      select: { id: true },
    });

    const shard0 = await tx.runShard.create({
      data: { runId: r.id, index: 0, total: 1 },
      select: { id: true },
    });

    const runTestData: {
      runId: string;
      testCaseId: string;
      testVersionId: string;
      shardIndex: number;
      browser: Browser;
      projectLabel: string;
    }[] = [];

    let shardCursor = 0;
    for (const tc of validTests) {
      for (const browser of browsers) {
        runTestData.push({
          runId: r.id,
          testCaseId: tc.id,
          testVersionId: tc.currentVersionId!,
          shardIndex: shardCursor % 1,
          browser,
          projectLabel: browser,
        });
        shardCursor++;
      }
    }

    await tx.runTest.createMany({ data: runTestData });
    return { run: r, shardId: shard0.id };
  });

  await enqueueRun(run.run.id, run.shardId, 0, 1, schedule.projectId);

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { lastRunAt: new Date() },
  });

  logger.info({ scheduleId, runId: run.run.id }, 'Schedule fired — run created');
}

export function startScheduleWorker(): void {
  if (_worker) return;

  const connection = getRedis() as Redis;
  _worker = new Worker<ScheduleJobData>(
    'sentinel-schedules',
    processScheduleJob,
    {
      connection,
      concurrency: 5,
    },
  );

  _worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Schedule job failed');
  });

  logger.info('Schedule worker started');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Sync a schedule with BullMQ. Creates/updates the repeatable job scheduler.
 * Call on create, update, enable, or disable.
 */
export async function syncSchedule(schedule: ScheduleRecord): Promise<void> {
  const queue = getScheduleQueue();
  const schedulerId = `schedule-${schedule.id}`;

  if (!schedule.isEnabled) {
    // Remove the job scheduler when disabled
    await removeSchedule(schedule.id);
    return;
  }

  await queue.upsertJobScheduler(
    schedulerId,
    {
      pattern: schedule.cron,
      tz: schedule.timezone,
    },
    {
      name: schedulerId,
      data: { scheduleId: schedule.id },
    },
  );

  logger.info({ scheduleId: schedule.id, cron: schedule.cron, tz: schedule.timezone }, 'Schedule synced');
}

/**
 * Remove a schedule's repeatable job from BullMQ.
 * Call on delete or disable.
 */
export async function removeSchedule(scheduleId: string): Promise<void> {
  const queue = getScheduleQueue();
  const schedulerId = `schedule-${scheduleId}`;

  try {
    await queue.removeJobScheduler(schedulerId);
    logger.info({ scheduleId }, 'Schedule removed from BullMQ');
  } catch (err) {
    logger.warn({ scheduleId, err }, 'Failed to remove schedule from BullMQ (may not exist)');
  }
}
