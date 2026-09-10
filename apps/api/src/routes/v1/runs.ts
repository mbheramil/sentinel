import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma, type Browser } from '@sentinel/db';
import { ERROR_CODES, CreateRunSchema, SSE_REPLAY_BATCH_SIZE } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId, getRunOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { enqueueRun } from '../../queue/producer.js';
import { getRedis, createSubscriber } from '../../lib/redis.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const RunSummaryShape = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentId: z.string(),
  suiteId: z.string().nullable().optional(),
  status: z.string(),
  trigger: z.string(),
  browsers: z.array(z.string()),
  shardCount: z.number(),
  traceMode: z.string(),
  gitRef: z.string().nullable(),
  gitSha: z.string().nullable(),
  totals: z.unknown(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  createdAt: z.string(),
  // Nullish, not just optional: routes that `include` the relation get an
  // object, routes that only `select` scalars omit it entirely, and Prisma
  // types the included relation as possibly null.
  environment: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    isDefault: z.boolean(),
  }).nullish(),
});

function serializeRun(r: {
  id: string;
  projectId: string;
  // Non-nullable in the schema (Run always belongs to an Environment), and
  // RunSummaryShape requires it — so it must not be optional here.
  environmentId: string;
  suiteId?: string | null;
  status: string;
  trigger: string;
  browsers: string[];
  shardCount: number;
  traceMode: string;
  gitRef: string | null;
  gitSha: string | null;
  totals: unknown;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  environment?: { id: string; name: string; baseUrl: string; isDefault: boolean } | null;
}) {
  return {
    ...r,
    queuedAt: r.queuedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // Resolve project slug → real cuid for all routes in this plugin
  a.addHook('preHandler', async (req) => {
    const p = req.params as Record<string, string>;
    for (const key of ['id', 'projectId']) {
      if (p[key] && !/^c[a-z0-9]{24,}/.test(p[key])) {
        const proj = await prisma.project.findFirst({ where: { slug: p[key] }, select: { id: true } });
        if (proj) p[key] = proj.id;
      }
    }
  });

  // ── POST /projects/:id/runs ────────────────────────────────────────────────
  a.post(
    '/projects/:id/runs',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: CreateRunSchema,
        response: {
          201: z.object({ runId: z.string(), status: z.string() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'runs:create');

      const { suiteId, testCaseIds, environmentId, browsers, shardCount, traceMode, gitRef, gitSha } = req.body;

      // Validate environment belongs to project
      const environment = await prisma.environment.findFirst({
        where: { id: environmentId, projectId: req.params.id },
        select: { id: true },
      });
      if (!environment) {
        return reply.status(422).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Environment not found in this project' },
        });
      }

      // Resolve test cases
      let resolvedTestIds: string[];
      if (suiteId) {
        const suite = await prisma.suite.findFirst({
          where: { id: suiteId, projectId: req.params.id },
          include: { items: { select: { testCaseId: true }, orderBy: { position: 'asc' } } },
        });
        if (!suite) {
          return reply.status(422).send({
            error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Suite not found in this project' },
          });
        }
        resolvedTestIds = suite.items.map((i) => i.testCaseId);
      } else {
        resolvedTestIds = testCaseIds!;
      }

      if (resolvedTestIds.length === 0) {
        return reply.status(422).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'No tests to run' },
        });
      }

      // Fetch test cases with current version
      const testCases = await prisma.testCase.findMany({
        where: { id: { in: resolvedTestIds }, projectId: req.params.id, isArchived: false },
        select: { id: true, currentVersionId: true, filePath: true },
      });

      const run = await prisma.$transaction(async (tx) => {
        const r = await tx.run.create({
          data: {
            projectId: req.params.id,
            suiteId: suiteId ?? undefined,
            environmentId,
            trigger: actor.apiKeyId ? 'API' : 'MANUAL',
            browsers,
            shardCount,
            traceMode,
            gitRef,
            gitSha,
            createdByUserId: actor.userId ?? undefined,
            createdByApiKeyId: actor.apiKeyId ?? undefined,
          },
          select: { id: true },
        });

        // Create shards
        await tx.runShard.createMany({
          data: Array.from({ length: shardCount }, (_, i) => ({
            runId: r.id,
            index: i,
            total: shardCount,
          })),
        });

        // Create RunTest rows — one per (testCase × browser), round-robin shard assignment
        const runTestData: {
          runId: string;
          testCaseId: string;
          testVersionId: string;
          shardIndex: number;
          browser: Browser;
          projectLabel: string;
        }[] = [];

        let shardCursor = 0;
        for (const tc of testCases) {
          if (!tc.currentVersionId) continue; // no version yet, skip
          for (const browser of browsers) {
            runTestData.push({
              runId: r.id,
              testCaseId: tc.id,
              testVersionId: tc.currentVersionId,
              shardIndex: shardCursor % shardCount,
              browser,
              projectLabel: browser,
            });
            shardCursor++;
          }
        }

        await tx.runTest.createMany({ data: runTestData });
        return r;
      });

      // Enqueue shards in BullMQ
      await Promise.all(
        Array.from({ length: shardCount }, (_, i) =>
          enqueueRun(run.id, i, shardCount, req.params.id),
        ),
      );

      return reply.status(201).send({ runId: run.id, status: 'QUEUED' });
    },
  );


  // ── GET /projects/:id/runs ────────────────────────────────────────────────
  a.get(
    '/projects/:id/runs',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          status: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            data: z.array(RunSummaryShape),
            meta: z.object({ page: z.number(), perPage: z.number(), total: z.number() }),
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
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const { status, page, perPage } = req.query;

      const where = {
        projectId: req.params.id,
        ...(status ? { status: status as never } : {}),
      };

      const [runs, total] = await Promise.all([
        prisma.run.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            environment: { select: { id: true, name: true, baseUrl: true, isDefault: true } },
          },
        }),
        prisma.run.count({ where }),
      ]);

      return reply.status(200).send({
        data: runs.map(serializeRun),
        meta: { page, perPage, total },
      });
    },
  );

  // ── GET /runs ──────────────────────────────────────────────────────────────
  a.get(
    '/runs',
    {
      schema: {
        querystring: z.object({
          projectId: z.string().optional(),
          status: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            data: z.array(RunSummaryShape),
            meta: z.object({ page: z.number(), perPage: z.number(), total: z.number() }),
          }),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!req.identity) {
        return reply.status(401).send({ error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' } });
      }

      const { projectId, status, from, to, page, perPage } = req.query;

      // Determine which project IDs the actor can access
      let allowedProjectIds: string[] | undefined;
      if (req.identity.type === 'apiKey') {
        const projects = await prisma.project.findMany({
          where: { orgId: req.identity.orgId! },
          select: { id: true },
        });
        allowedProjectIds = projects.map((p) => p.id);
      } else {
        const memberships = await prisma.membership.findMany({
          where: { userId: req.identity.userId! },
          select: { orgId: true },
        });
        const orgIds = memberships.map((m) => m.orgId);
        const projects = await prisma.project.findMany({
          where: { orgId: { in: orgIds } },
          select: { id: true },
        });
        allowedProjectIds = projects.map((p) => p.id);
      }

      // Apply project-level access scoping
      if (projectId && !allowedProjectIds.includes(projectId)) {
        // Caller asked for a specific project they can't access — return empty
        return reply.status(200).send({ data: [], meta: { page, perPage, total: 0 } });
      }
      const projectIdFilter: { in: string[] } | string = projectId ?? { in: allowedProjectIds };

      const where = {
        projectId: projectIdFilter,
        ...(status ? { status: status as never } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      };

      const [runs, total] = await Promise.all([
        prisma.run.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          select: {
            id: true,
            projectId: true,
            environmentId: true,
            suiteId: true,
            status: true,
            trigger: true,
            browsers: true,
            shardCount: true,
            traceMode: true,
            gitRef: true,
            gitSha: true,
            totals: true,
            queuedAt: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            createdAt: true,
          },
        }),
        prisma.run.count({ where }),
      ]);

      return reply.status(200).send({
        data: runs.map(serializeRun),
        meta: { page, perPage, total },
      });
    },
  );

  // ── GET /runs/:id ──────────────────────────────────────────────────────────
  a.get(
    '/runs/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: RunSummaryShape.extend({
            shards: z.array(
              z.object({
                id: z.string(),
                index: z.number(),
                total: z.number(),
                status: z.string(),
                attemptCount: z.number(),
                claimedAt: z.string().nullable(),
                finishedAt: z.string().nullable(),
              }),
            ),
            runTests: z.array(
              z.object({
                id: z.string(),
                testCaseId: z.string(),
                browser: z.string(),
                status: z.string(),
                durationMs: z.number().nullable(),
                shardIndex: z.number(),
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
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const run = await prisma.run.findUnique({
        where: { id: req.params.id },
        include: {
          shards: {
            select: { id: true, index: true, total: true, status: true, attemptCount: true, claimedAt: true, finishedAt: true },
            orderBy: { index: 'asc' },
          },
          runTests: {
            select: { id: true, testCaseId: true, browser: true, status: true, durationMs: true, shardIndex: true },
          },
        },
      });
      if (!run) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      return reply.status(200).send({
        ...serializeRun(run),
        shards: run.shards.map((s) => ({
          ...s,
          claimedAt: s.claimedAt?.toISOString() ?? null,
          finishedAt: s.finishedAt?.toISOString() ?? null,
        })),
        runTests: run.runTests,
      });
    },
  );

  // ── GET /runs/:id/tests ────────────────────────────────────────────────────
  a.get(
    '/runs/:id/tests',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          status: z.string().optional(),
        }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              runId: z.string(),
              testCaseId: z.string(),
              browser: z.string(),
              projectLabel: z.string(),
              status: z.string(),
              durationMs: z.number().nullable(),
              attemptCount: z.number(),
            }),
          ),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }
      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const { status } = req.query;
      const where: Record<string, unknown> = { runId: req.params.id };
      if (status === 'flaky') {
        where['status'] = 'FLAKY';
      } else if (status && status !== 'muted') {
        where['status'] = status.toUpperCase();
      }

      const runTests = await prisma.runTest.findMany({
        where,
        include: {
          attempts: { select: { id: true }, orderBy: { index: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(
        runTests.map((rt) => ({
          id: rt.id,
          runId: rt.runId,
          testCaseId: rt.testCaseId,
          browser: rt.browser,
          projectLabel: rt.projectLabel,
          status: rt.status,
          durationMs: rt.durationMs,
          attemptCount: rt.attempts.length,
        })),
      );
    },
  );

  // ── POST /runs/:id/cancel ──────────────────────────────────────────────────
  a.post(
    '/runs/:id/cancel',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'runs:cancel');

      await prisma.run.update({
        where: { id: req.params.id },
        data: { status: 'CANCELED', finishedAt: new Date() },
      });

      // Signal runners via Redis pub/sub
      try {
        await getRedis().publish(`run:${req.params.id}:control`, JSON.stringify({ action: 'cancel' }));
      } catch {
        // Non-fatal — runners will notice via heartbeat timeout
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── POST /runs/:id/retry ───────────────────────────────────────────────────
  a.post(
    '/runs/:id/retry',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({ failedOnly: z.string().optional().transform((v) => v === 'true') }),
        response: {
          201: z.object({ runId: z.string(), status: z.string() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'runs:retry');

      const original = await prisma.run.findUnique({
        where: { id: req.params.id },
        include: {
          runTests: {
            select: { testCaseId: true, testVersionId: true, browser: true, shardIndex: true, status: true, projectLabel: true },
          },
        },
      });
      if (!original) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      const testsToRetry = req.query.failedOnly
        ? original.runTests.filter((t) => t.status === 'FAILED' || t.status === 'TIMED_OUT')
        : original.runTests;

      const newRun = await prisma.$transaction(async (tx) => {
        const r = await tx.run.create({
          data: {
            projectId: original.projectId,
            suiteId: original.suiteId,
            environmentId: original.environmentId,
            trigger: 'RETRY',
            browsers: original.browsers,
            shardCount: original.shardCount,
            traceMode: original.traceMode,
            gitRef: original.gitRef,
            gitSha: original.gitSha,
            retryOfRunId: original.id,
            createdByUserId: actor.userId ?? undefined,
            createdByApiKeyId: actor.apiKeyId ?? undefined,
          },
          select: { id: true },
        });

        await tx.runShard.createMany({
          data: Array.from({ length: original.shardCount }, (_, i) => ({
            runId: r.id,
            index: i,
            total: original.shardCount,
          })),
        });

        await tx.runTest.createMany({
          data: testsToRetry.map((t) => ({
            runId: r.id,
            testCaseId: t.testCaseId,
            testVersionId: t.testVersionId,
            shardIndex: t.shardIndex,
            browser: t.browser,
            projectLabel: t.projectLabel,
          })),
        });

        return r;
      });

      await Promise.all(
        Array.from({ length: original.shardCount }, (_, i) =>
          enqueueRun(newRun.id, i, original.shardCount, original.projectId),
        ),
      );

      return reply.status(201).send({ runId: newRun.id, status: 'QUEUED' });
    },
  );

  // ── GET /runs/:id/events (SSE) ─────────────────────────────────────────────
  a.get(
    '/runs/:id/events',
    {
      schema: {
        params: z.object({ id: z.string() }),
        // SSE — no response schema (raw stream)
      },
    },
    async (req, reply) => {
      const orgId = await getRunOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      // Authenticate but allow read for any org member
      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const runId = req.params.id;
      // A repeated header arrives as an array; SSE only ever sends one, so take
      // the first value.
      const lastEventIdHeader = req.headers['last-event-id'];
      const lastEventId = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
      const parsedSeq = lastEventId ? parseInt(lastEventId, 10) : NaN;
      const resumeAfterSeq = Number.isFinite(parsedSeq) ? parsedSeq : -1;

      // Hijack the connection for raw SSE
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      raw.flushHeaders();

      const writeEvent = (seq: number, data: unknown): void => {
        raw.write(`id: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const writeComment = (): void => {
        raw.write(': keep-alive\n\n');
      };

      // 1. Replay persisted events from DB
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const batch = await prisma.runEvent.findMany({
          where: { runId, seq: { gt: resumeAfterSeq } },
          orderBy: { seq: 'asc' },
          take: SSE_REPLAY_BATCH_SIZE,
          skip: offset,
          select: { seq: true, type: true, ts: true, payload: true, shardIndex: true },
        });
        for (const evt of batch) {
          writeEvent(evt.seq, { type: evt.type, ts: evt.ts.toISOString(), shardIndex: evt.shardIndex, payload: evt.payload });
        }
        hasMore = batch.length === SSE_REPLAY_BATCH_SIZE;
        offset += batch.length;
      }

      // 2. Subscribe to live Redis channel for new events
      const channel = `run:${runId}`;
      const sub = createSubscriber();
      let closed = false;

      // Keep-alive ping every 30 s
      const ping = setInterval(() => {
        if (!closed) writeComment();
      }, 30_000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        sub.unsubscribe(channel).catch(() => {});
        sub.quit().catch(() => {});
        raw.end();
      };

      req.socket.on('close', cleanup);
      req.socket.on('error', cleanup);

      sub.on('message', (_ch: string, message: string) => {
        if (closed) return;
        try {
          const evt = JSON.parse(message) as { seq: number; [k: string]: unknown };
          if (evt.seq > resumeAfterSeq) {
            writeEvent(evt.seq, evt);
          }
        } catch {
          // malformed message — skip
        }
      });

      sub.on('error', cleanup);

      await sub.subscribe(channel);
    },
  );
}
