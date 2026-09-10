import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId, getRunOrgId, getTestCaseOrgId } from '../../lib/actor.js';
import { presignGet } from '../../services/artifacts.js';

// ── Shared error shape ────────────────────────────────────────────────────────

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ── Org-resolution helpers for Phase 2 entities ──────────────────────────────

async function getArtifactOrgId(artifactId: string): Promise<string | null> {
  const artifact = await prisma.artifact.findUnique({
    where: { id: artifactId },
    select: {
      run: { select: { project: { select: { orgId: true } } } },
      attempt: {
        select: {
          runTest: {
            select: { run: { select: { project: { select: { orgId: true } } } } },
          },
        },
      },
    },
  });
  if (!artifact) return null;
  return (
    artifact.run?.project.orgId ??
    artifact.attempt?.runTest.run.project.orgId ??
    null
  );
}

async function getRunTestOrgId(runTestId: string): Promise<string | null> {
  const rt = await prisma.runTest.findUnique({
    where: { id: runTestId },
    select: { run: { select: { project: { select: { orgId: true } } } } },
  });
  return rt?.run.project.orgId ?? null;
}

async function getAttemptOrgId(attemptId: string): Promise<string | null> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      runTest: {
        select: { run: { select: { project: { select: { orgId: true } } } } },
      },
    },
  });
  return attempt?.runTest.run.project.orgId ?? null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function phase2Routes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /artifacts/:id/url ─────────────────────────────────────────────────
  // Returns a short-lived presigned GET URL (10 min).
  // Auth required; actor must be a member of the artifact's org.
  a.get(
    '/artifacts/:id/url',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ url: z.string(), expiresInSeconds: z.number() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getArtifactOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Artifact not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const artifact = await prisma.artifact.findUnique({
        where: { id: req.params.id },
        select: { storageKey: true },
      });
      if (!artifact) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Artifact not found' },
        });
      }

      const expiresInSeconds = 600; // 10 minutes
      const url = await presignGet(artifact.storageKey, expiresInSeconds);
      return reply.status(200).send({ url, expiresInSeconds });
    },
  );

  // ── GET /runs/:id/report ───────────────────────────────────────────────────
  // Returns a presigned GET URL (10 min) for the HTML_REPORT artifact of this run.
  a.get(
    '/runs/:id/report',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ url: z.string(), expiresInSeconds: z.number() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const report = await prisma.artifact.findFirst({
        where: { runId: req.params.id, kind: 'HTML_REPORT' },
        select: { storageKey: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!report) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'HTML report not found for this run' },
        });
      }

      const expiresInSeconds = 600;
      const url = await presignGet(report.storageKey, expiresInSeconds);
      return reply.status(200).send({ url, expiresInSeconds });
    },
  );

  // ── GET /tests/:id/history ─────────────────────────────────────────────────
  // Returns test execution history ordered by most recent first.
  // Supports ?browser=CHROMIUM&limit=30
  // Powers sparklines in the UI.
  a.get(
    '/tests/:id/history',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          browser: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: {
          200: z.array(
            z.object({
              runId: z.string(),
              runAt: z.string(),
              status: z.string(),
              durationMs: z.number().nullable(),
              attemptCount: z.number(),
              flaky: z.boolean(),
            }),
          ),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const { browser, limit } = req.query;

      const runTests = await prisma.runTest.findMany({
        where: {
          testCaseId: req.params.id,
          ...(browser ? { browser: browser as 'CHROMIUM' | 'FIREFOX' | 'WEBKIT' } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          runId: true,
          status: true,
          durationMs: true,
          run: { select: { createdAt: true } },
          attempts: { select: { id: true } },
        },
      });

      return reply.status(200).send(
        runTests.map((rt) => ({
          runId: rt.runId,
          runAt: rt.run.createdAt.toISOString(),
          status: rt.status,
          durationMs: rt.durationMs,
          attemptCount: rt.attempts.length,
          flaky: rt.status === 'FLAKY',
        })),
      );
    },
  );

  // ── GET /projects/:id/insights ─────────────────────────────────────────────
  // Returns flakiest tests, slowest tests (top 10 each from windowDays=7 TestStat),
  // and a 14-day pass-rate trend from Run rows.
  a.get(
    '/projects/:id/insights',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            flakyTests: z.array(
              z.object({
                testId: z.string(),
                testName: z.string(),
                browser: z.string(),
                flakeScore: z.number(),
                p95DurationMs: z.number(),
                runs7d: z.number(),
              }),
            ),
            slowestTests: z.array(
              z.object({
                testId: z.string(),
                testName: z.string(),
                browser: z.string(),
                p95DurationMs: z.number(),
                p50DurationMs: z.number(),
              }),
            ),
            passRateTrend: z.array(
              z.object({
                date: z.string(),
                passRate: z.number(),
                total: z.number(),
                passed: z.number(),
              }),
            ),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      // Flakiest tests: top 10 by flakeScore, windowDays=7
      const flakiestStats = await prisma.testStat.findMany({
        where: { projectId: req.params.id, windowDays: 7 },
        include: { testCase: { select: { name: true } } },
        orderBy: { flakeScore: 'desc' },
        take: 10,
      });

      const flakiestTests = flakiestStats.map((ts) => ({
        testId: ts.testCaseId,
        testName: ts.testCase.name,
        browser: ts.browser as string,
        flakeScore: ts.flakeScore,
        p95DurationMs: ts.p95DurationMs,
        runs7d: ts.runs,
      }));

      // Slowest tests: top 10 by p95DurationMs, windowDays=7
      const slowestStats = await prisma.testStat.findMany({
        where: { projectId: req.params.id, windowDays: 7 },
        include: { testCase: { select: { name: true } } },
        orderBy: { p95DurationMs: 'desc' },
        take: 10,
      });

      const slowestTests = slowestStats.map((ts) => ({
        testId: ts.testCaseId,
        testName: ts.testCase.name,
        browser: ts.browser as string,
        p95DurationMs: ts.p95DurationMs,
        p50DurationMs: ts.p50DurationMs,
      }));

      // Pass-rate trend: last 14 days of terminal runs, grouped by date
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const recentRuns = await prisma.run.findMany({
        where: {
          projectId: req.params.id,
          status: { in: ['PASSED', 'FAILED', 'ERROR', 'TIMED_OUT', 'CANCELED'] },
          finishedAt: { gte: since },
        },
        select: { finishedAt: true, totals: true },
        orderBy: { finishedAt: 'asc' },
      });

      const dailyMap = new Map<string, { total: number; passed: number }>();
      for (const run of recentRuns) {
        if (!run.finishedAt) continue;
        const date = run.finishedAt.toISOString().slice(0, 10);
        const totals = run.totals as { total?: number; passed?: number };
        const entry = dailyMap.get(date) ?? { total: 0, passed: 0 };
        dailyMap.set(date, {
          total: entry.total + (totals.total ?? 0),
          passed: entry.passed + (totals.passed ?? 0),
        });
      }

      const passRateTrend = Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, { total, passed }]) => ({
          date,
          passRate: total > 0 ? passed / total : 0,
          total,
          passed,
        }));

      return reply.status(200).send({ flakyTests: flakiestTests, slowestTests, passRateTrend });
    },
  );

  // ── GET /run-tests/:id ─────────────────────────────────────────────────────
  // Returns a RunTest with all embedded Attempts, each with StepResults.
  a.get(
    '/run-tests/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            id: z.string(),
            runId: z.string(),
            testCaseId: z.string(),
            browser: z.string(),
            status: z.string(),
            durationMs: z.number().nullable(),
            attempts: z.array(
              z.object({
                id: z.string(),
                index: z.number(),
                status: z.string(),
                startedAt: z.string().nullable(),
                finishedAt: z.string().nullable(),
                durationMs: z.number().nullable(),
                errorName: z.string().nullable(),
                errorMessage: z.string().nullable(),
                errorStack: z.string().nullable(),
                steps: z.array(
                  z.object({
                    id: z.string(),
                    position: z.number(),
                    depth: z.number(),
                    title: z.string(),
                    category: z.string(),
                    status: z.string(),
                    durationMs: z.number().nullable(),
                    errorMessage: z.string().nullable(),
                  }),
                ),
              }),
            ),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getRunTestOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'RunTest not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const runTest = await prisma.runTest.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          runId: true,
          testCaseId: true,
          browser: true,
          status: true,
          durationMs: true,
          attempts: {
            orderBy: { index: 'asc' },
            select: {
              id: true,
              index: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              durationMs: true,
              errorName: true,
              errorMessage: true,
              errorStack: true,
              steps: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  position: true,
                  depth: true,
                  title: true,
                  category: true,
                  status: true,
                  durationMs: true,
                  errorMessage: true,
                },
              },
            },
          },
        },
      });

      if (!runTest) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'RunTest not found' },
        });
      }

      return reply.status(200).send({
        ...runTest,
        browser: runTest.browser as string,
        status: runTest.status as string,
        attempts: runTest.attempts.map((att) => ({
          ...att,
          status: att.status as string,
          startedAt: att.startedAt?.toISOString() ?? null,
          finishedAt: att.finishedAt?.toISOString() ?? null,
          steps: att.steps.map((s) => ({ ...s, status: s.status as string })),
        })),
      });
    },
  );

  // ── GET /attempts/:id ──────────────────────────────────────────────────────
  // Returns a single Attempt with StepResults and Artifact metadata.
  a.get(
    '/attempts/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            id: z.string(),
            runTestId: z.string(),
            index: z.number(),
            status: z.string(),
            startedAt: z.string().nullable(),
            finishedAt: z.string().nullable(),
            durationMs: z.number().nullable(),
            errorName: z.string().nullable(),
            errorMessage: z.string().nullable(),
            errorStack: z.string().nullable(),
            steps: z.array(
              z.object({
                id: z.string(),
                position: z.number(),
                depth: z.number(),
                title: z.string(),
                category: z.string(),
                status: z.string(),
                durationMs: z.number().nullable(),
                errorMessage: z.string().nullable(),
              }),
            ),
            artifacts: z.array(
              z.object({
                id: z.string(),
                kind: z.string(),
                contentType: z.string(),
                sizeBytes: z.number(),
                label: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getAttemptOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const attempt = await prisma.attempt.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          runTestId: true,
          index: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          errorName: true,
          errorMessage: true,
          errorStack: true,
          steps: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              depth: true,
              title: true,
              category: true,
              status: true,
              durationMs: true,
              errorMessage: true,
            },
          },
          artifacts: {
            select: {
              id: true,
              kind: true,
              contentType: true,
              sizeBytes: true,
              label: true,
              createdAt: true,
            },
          },
        },
      });

      if (!attempt) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' },
        });
      }

      return reply.status(200).send({
        ...attempt,
        status: attempt.status as string,
        startedAt: attempt.startedAt?.toISOString() ?? null,
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
        steps: attempt.steps.map((s) => ({ ...s, status: s.status as string })),
        artifacts: attempt.artifacts.map((art) => ({
          ...art,
          kind: art.kind as string,
          createdAt: art.createdAt.toISOString(),
        })),
      });
    },
  );
}
