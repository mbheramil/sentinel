import { prisma } from '@sentinel/db';
import type { Browser } from '@sentinel/db';
import { logger } from '../logger.js';

/**
 * Compute the p-th percentile of a pre-sorted numeric array.
 * Returns 0 for empty arrays.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))]!;
}

/**
 * Compute (or recompute) flake stats for a single (testCase, browser, window) triple
 * and upsert the result into the TestStat table.
 *
 * Called:
 *  - After each shard completion (fire-and-forget) for windowDays=7 and windowDays=30
 *  - Nightly by the stats reconciler for windowDays=30
 */
export async function computeTestStats(
  testCaseId: string,
  browser: Browser,
  windowDays: 7 | 30,
): Promise<void> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const tc = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { projectId: true },
  });
  if (!tc) {
    logger.warn({ testCaseId }, 'computeTestStats: TestCase not found, skipping');
    return;
  }

  const runTests = await prisma.runTest.findMany({
    where: {
      testCaseId,
      browser,
      createdAt: { gte: since },
    },
    select: { status: true, durationMs: true },
  });

  const runs = runTests.length;
  if (runs === 0) {
    logger.debug({ testCaseId, browser, windowDays }, 'computeTestStats: no data in window, skipping upsert');
    return;
  }

  let failures = 0;
  let flakes = 0;
  const durations: number[] = [];

  for (const rt of runTests) {
    if (rt.status === 'FAILED' || rt.status === 'TIMED_OUT') failures++;
    if (rt.status === 'FLAKY') flakes++;
    if (rt.durationMs != null) durations.push(rt.durationMs);
  }

  const flakeScore = flakes / runs; // 0..1
  durations.sort((a, b) => a - b);
  const p50DurationMs = percentile(durations, 50);
  const p95DurationMs = percentile(durations, 95);

  await prisma.testStat.upsert({
    where: {
      testCaseId_browser_windowDays: { testCaseId, browser, windowDays },
    },
    create: {
      testCaseId,
      projectId: tc.projectId,
      browser,
      windowDays,
      runs,
      failures,
      flakes,
      flakeScore,
      p50DurationMs,
      p95DurationMs,
      computedAt: new Date(),
    },
    update: {
      runs,
      failures,
      flakes,
      flakeScore,
      p50DurationMs,
      p95DurationMs,
      computedAt: new Date(),
    },
  });

  logger.debug(
    { testCaseId, browser, windowDays, flakeScore, runs, failures, flakes },
    'computeTestStats: upserted TestStat',
  );
}
