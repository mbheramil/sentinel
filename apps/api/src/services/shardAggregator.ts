/**
 * shardAggregator.ts — Phase 6 Part A
 *
 * Aggregates results across all shards of a run once every shard reaches a
 * terminal state. Called by PATCH /internal/shards/:id/complete.
 */
import { prisma } from '@sentinel/db';
import { TERMINAL_RUN_STATUSES } from '@sentinel/shared';
import { logger } from '../logger.js';
import { fireNotifications } from './notifications.js';
import type { NotificationPayload } from './notifications.js';

type RunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELED' | 'ERROR' | 'TIMED_OUT';

export async function aggregateRunShards(runId: string): Promise<void> {
  // 1. Load run with all shards and all RunTest results
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      project: { select: { id: true, name: true, orgId: true } },
      environment: { select: { id: true, name: true } },
      shards: {
        select: {
          id: true,
          status: true,
          claimedAt: true,
          finishedAt: true,
        },
      },
      runTests: {
        select: {
          status: true,
          durationMs: true,
          testCase: { select: { isMuted: true } },
          attempts: {
            orderBy: { index: 'desc' },
            take: 1,
            select: {
              errorName: true,
              errorMessage: true,
              finalUrl: true,
              consoleErrorCount: true,
              networkErrorCount: true,
              topDiagnostics: true,
              steps: {
                where: { status: 'FAILED' },
                take: 1,
                select: { title: true },
                orderBy: { position: 'asc' },
              },
            },
          },
          testCase: {
            select: {
              isMuted: true,
              name: true,
            },
          },
          browser: true,
        },
      },
    },
  });

  if (!run) return;

  // 1. Check if ALL shards are terminal
  const allShardsTerminal = run.shards.every((s) =>
    TERMINAL_RUN_STATUSES.includes(s.status as (typeof TERMINAL_RUN_STATUSES)[number]),
  );
  if (!allShardsTerminal) return;

  // 2. Tally test results (muted tests do not affect run status)
  let total = 0;
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;
  let muted = 0;
  let timedOut = 0;

  for (const t of run.runTests) {
    total++;
    if (t.testCase.isMuted) {
      muted++;
      continue;
    }
    if (t.status === 'PASSED') passed++;
    else if (t.status === 'FAILED') failed++;
    else if (t.status === 'FLAKY') flaky++;
    else if (t.status === 'SKIPPED') skipped++;
    else if (t.status === 'TIMED_OUT') timedOut++;
  }

  // 3. Determine final run status from shard statuses + test results
  const shardStatuses = run.shards.map((s) => s.status);
  let finalStatus: RunStatus = 'PASSED';
  if (shardStatuses.includes('ERROR')) finalStatus = 'ERROR';
  else if (failed > 0 || timedOut > 0) finalStatus = 'FAILED';
  else if (shardStatuses.includes('CANCELED')) finalStatus = 'CANCELED';

  // 4. Compute finishedAt and durationMs (max across shards)
  const now = new Date();

  // durationMs = time from run.startedAt to the latest shard finishedAt (or now)
  const latestShardFinish = run.shards.reduce<Date | null>((best, s) => {
    if (!s.finishedAt) return best;
    if (!best || s.finishedAt > best) return s.finishedAt;
    return best;
  }, null);

  const finishedAt = latestShardFinish ?? now;
  const durationMs = run.startedAt
    ? finishedAt.getTime() - run.startedAt.getTime()
    : null;

  await prisma.run.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      finishedAt,
      durationMs,
      totals: { total, passed, failed, flaky, skipped, muted, timedOut },
    },
  });

  logger.info(
    { runId, finalStatus, totals: { total, passed, failed, flaky, skipped } },
    'shardAggregator: run rollup computed',
  );

  // 5. Fire notifications
  const failedTests = run.runTests
    .filter((t) => !t.testCase.isMuted && (t.status === 'FAILED' || t.status === 'TIMED_OUT'))
    .map((t) => {
      const lastAttempt = t.attempts[0];
      return {
        name: t.testCase.name,
        browser: String(t.browser),
        error: lastAttempt?.errorMessage ?? lastAttempt?.errorName ?? t.status,
        stepTitle: lastAttempt?.steps?.[0]?.title,
        finalUrl: lastAttempt?.finalUrl ?? undefined,
      };
    });

  // Determine event type (recovered = prev run failed, this one passed)
  let event: NotificationPayload['event'] = 'run.passed';
  if (finalStatus === 'FAILED' || finalStatus === 'ERROR' || finalStatus === 'TIMED_OUT') {
    event = 'run.failed';
  } else if (flaky > 0 && failed === 0) {
    event = 'run.flaky';
  }

  const topDiagnostics: NotificationPayload['topDiagnostics'] = {
    consoleErrors: [],
    networkErrors: [],
  };

  // Collect top diagnostics from failed attempts
  for (const t of run.runTests) {
    if (t.attempts[0]?.topDiagnostics != null) {
      const diag = t.attempts[0].topDiagnostics as {
        consoleErrors?: unknown[];
        networkErrors?: unknown[];
      };
      if (diag.consoleErrors) {
        topDiagnostics.consoleErrors.push(...diag.consoleErrors.slice(0, 2));
      }
      if (diag.networkErrors) {
        topDiagnostics.networkErrors.push(...diag.networkErrors.slice(0, 2));
      }
    }
  }

  await fireNotifications({
    event,
    run: {
      id: runId,
      projectId: run.projectId,
      status: finalStatus,
      durationMs,
      project: {
        id: run.project.id,
        name: run.project.name,
        orgId: run.project.orgId,
      },
      environment: {
        id: run.environment.id,
        name: run.environment.name,
      },
    },
    failedTests,
    topDiagnostics,
  });
}
