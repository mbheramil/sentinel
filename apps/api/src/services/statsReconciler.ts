import { prisma } from '@sentinel/db';
import type { Browser } from '@sentinel/db';
import { TERMINAL_RUN_STATUSES } from '@sentinel/shared';
import { computeTestStats } from './flakeScorer.js';
import { logger } from '../logger.js';

interface StoredTotals {
  total?: number;
  passed?: number;
  failed?: number;
  flaky?: number;
  skipped?: number;
  muted?: number;
  timedOut?: number;
}

/**
 * Nightly stats reconciler.
 *
 * Part 1 — Run totals audit:
 *   For every terminal Run, re-derive totals from RunTest rows and compare
 *   with the stored Run.totals JSON. Logs a WARN on divergence — does NOT
 *   silently fix data.
 *
 * Part 2 — TestStat refresh:
 *   Recompute TestStat for every (testCaseId, browser) combination that had
 *   at least one RunTest in the last 30 days, for both windowDays=7 and
 *   windowDays=30.
 */
export async function runStatsReconciler(): Promise<void> {
  logger.info('StatsReconciler: starting');

  // ── Part 1: Run totals audit ───────────────────────────────────────────────
  const terminalRuns = await prisma.run.findMany({
    where: {
      status: {
        in: TERMINAL_RUN_STATUSES as ('PASSED' | 'FAILED' | 'CANCELED' | 'ERROR' | 'TIMED_OUT')[],
      },
    },
    select: {
      id: true,
      totals: true,
      runTests: {
        select: {
          status: true,
          testCase: { select: { isMuted: true } },
        },
      },
    },
  });

  let divergentRuns = 0;

  for (const run of terminalRuns) {
    let total = 0, passed = 0, failed = 0, flaky = 0, skipped = 0, muted = 0, timedOut = 0;

    for (const rt of run.runTests) {
      total++;
      if (rt.testCase.isMuted) {
        muted++;
        continue;
      }
      if (rt.status === 'PASSED') passed++;
      else if (rt.status === 'FAILED') failed++;
      else if (rt.status === 'FLAKY') flaky++;
      else if (rt.status === 'SKIPPED') skipped++;
      else if (rt.status === 'TIMED_OUT') timedOut++;
    }

    const derived = { total, passed, failed, flaky, skipped, muted, timedOut };
    const stored = run.totals as StoredTotals;

    const isDivergent =
      (stored.total ?? 0) !== derived.total ||
      (stored.passed ?? 0) !== derived.passed ||
      (stored.failed ?? 0) !== derived.failed ||
      (stored.flaky ?? 0) !== derived.flaky ||
      (stored.skipped ?? 0) !== derived.skipped ||
      (stored.muted ?? 0) !== derived.muted ||
      (stored.timedOut ?? 0) !== derived.timedOut;

    if (isDivergent) {
      divergentRuns++;
      logger.warn(
        { runId: run.id, stored, derived },
        'StatsReconciler: run totals diverge from RunTest rows — NOT auto-fixing',
      );
    }
  }

  logger.info(
    { totalTerminalRuns: terminalRuns.length, divergentRuns },
    'StatsReconciler: run totals audit complete',
  );

  // ── Part 2: TestStat refresh ───────────────────────────────────────────────
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const activeRunTests = await prisma.runTest.findMany({
    where: { createdAt: { gte: since } },
    select: { testCaseId: true, browser: true },
    distinct: ['testCaseId', 'browser'],
  });

  logger.info({ count: activeRunTests.length }, 'StatsReconciler: recomputing TestStats for active tests');

  let statErrors = 0;
  for (const { testCaseId, browser } of activeRunTests) {
    for (const windowDays of [7, 30] as const) {
      try {
        await computeTestStats(testCaseId, browser as Browser, windowDays);
      } catch (err) {
        statErrors++;
        logger.error({ err, testCaseId, browser, windowDays }, 'StatsReconciler: computeTestStats failed');
      }
    }
  }

  logger.info({ statErrors }, 'StatsReconciler: complete');
}
