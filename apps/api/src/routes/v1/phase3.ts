/**
 * Phase 3 API routes — Suites, Schedules, Integrations, Capture Endpoints, Tasks.
 *
 * Register the main export in server.ts:
 *   await app.register(phase3Routes, { prefix: '/api/v1' });
 *   await app.register(hookRoutes);   // public capture-endpoint webhook at root
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma, Prisma, type Browser } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { encrypt, envelopeToBuffer } from '../../services/encryption.js';
import { syncSchedule, removeSchedule, startScheduleWorker } from '../../services/scheduleSync.js';
import { sendTestNotification, startNotificationWorker } from '../../services/notifications.js';
import { enqueueRun } from '../../queue/producer.js';

// ─── Shared schemas ─────────────────────────────────────────────────────────

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ─── Helper: resolve orgId from various resource types ──────────────────────

async function getSuiteOrgId(suiteId: string): Promise<string | null> {
  const suite = await prisma.suite.findUnique({
    where: { id: suiteId },
    select: { project: { select: { orgId: true } } },
  });
  return suite?.project.orgId ?? null;
}

async function getScheduleOrgId(scheduleId: string): Promise<string | null> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { project: { select: { orgId: true } } },
  });
  return schedule?.project.orgId ?? null;
}

async function getCaptureEndpointOrgId(endpointId: string): Promise<string | null> {
  const ep = await prisma.captureEndpoint.findUnique({
    where: { id: endpointId },
    select: { project: { select: { orgId: true } } },
  });
  return ep?.project.orgId ?? null;
}

async function getTaskOrgId(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { orgId: true } } },
  });
  return task?.project.orgId ?? null;
}

/**
 * Convert a Zod-validated object into a value Prisma accepts for a nullable
 * Json column.
 *
 * `z.record(z.unknown())` yields `Record<string, unknown>`, and `unknown` is not
 * assignable to `Prisma.InputJsonValue` — but the value came off a parsed JSON
 * body, so it is JSON-serialisable by construction. An explicit `null` means
 * "clear the column", which Prisma spells `DbNull`; a bare `null` would be read
 * as "no change".
 */
function toJsonInput(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

// ─── Suite shapes ───────────────────────────────────────────────────────────

const SuiteShape = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  mode: z.string(),
  tagQuery: z.unknown().nullable(),
  setupTaskId: z.string().nullable(),
  teardownTaskId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SuiteItemShape = z.object({
  id: z.string(),
  suiteId: z.string(),
  testCaseId: z.string(),
  position: z.number(),
});

function serializeSuite(s: {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  mode: string;
  tagQuery: unknown;
  setupTaskId: string | null;
  teardownTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
}

// ─── Schedule shapes ────────────────────────────────────────────────────────

const ScheduleShape = z.object({
  id: z.string(),
  projectId: z.string(),
  suiteId: z.string().nullable(),
  taskId: z.string().nullable(),
  environmentId: z.string(),
  name: z.string(),
  cron: z.string(),
  timezone: z.string(),
  browsers: z.array(z.string()),
  isEnabled: z.boolean(),
  overlapPolicy: z.string(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function serializeSchedule(s: {
  id: string;
  projectId: string;
  suiteId: string | null;
  taskId: string | null;
  environmentId: string;
  name: string;
  cron: string;
  timezone: string;
  browsers: string[];
  isEnabled: boolean;
  overlapPolicy: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...s,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    nextRunAt: s.nextRunAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ─── Integration shapes ─────────────────────────────────────────────────────

const IntegrationShape = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string().nullable(),
  type: z.string(),
  name: z.string(),
  events: z.array(z.string()),
  isEnabled: z.boolean(),
  consecutiveFailures: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function serializeIntegration(i: {
  id: string;
  orgId: string;
  projectId: string | null;
  type: string;
  name: string;
  events: string[];
  isEnabled: boolean;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() };
}

// ─── Capture endpoint shapes ─────────────────────────────────────────────────

const CaptureEndpointShape = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string(),
  retentionHours: z.number(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function serializeCaptureEndpoint(e: {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  retentionHours: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...e, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() };
}

// ─── Task shapes ────────────────────────────────────────────────────────────

const TaskShape = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentId: z.string(),
  name: z.string(),
  kind: z.string(),
  code: z.string(),
  isEnabled: z.boolean(),
  timeoutMs: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function serializeTask(t: {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  kind: string;
  code: string;
  isEnabled: boolean;
  timeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PLUGIN
// ═══════════════════════════════════════════════════════════════════════════

export async function phase3Routes(app: FastifyInstance): Promise<void> {
  // Start background workers once the server is ready
  app.addHook('onReady', async () => {
    startScheduleWorker();
    startNotificationWorker();
  });

  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // Resolve project slug → real cuid
  a.addHook('preHandler', async (req) => {
    const p = req.params as Record<string, string>;
    for (const key of ['id', 'projectId']) {
      if (p[key] && !/^c[a-z0-9]{24,}/.test(p[key])) {
        const proj = await prisma.project.findFirst({ where: { slug: p[key] }, select: { id: true } });
        if (proj) p[key] = proj.id;
      }
    }
  });

  // ── SUITES ────────────────────────────────────────────────────────────────

  // GET /projects/:projectId/suites
  a.get(
    '/projects/:projectId/suites',
    {
      schema: {
        params: z.object({ projectId: z.string() }),
        response: { 200: z.array(SuiteShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const suites = await prisma.suite.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(suites.map(serializeSuite));
    },
  );

  // POST /projects/:projectId/suites
  a.post(
    '/projects/:projectId/suites',
    {
      schema: {
        params: z.object({ projectId: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255),
          description: z.string().optional(),
          mode: z.enum(['EXPLICIT', 'TAG_QUERY']).default('EXPLICIT'),
          tagQuery: z.record(z.unknown()).optional(),
        }),
        response: { 201: SuiteShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:create');

      const suite = await prisma.suite.create({
        data: {
          projectId: req.params.projectId,
          name: req.body.name,
          description: req.body.description,
          mode: req.body.mode,
          tagQuery: toJsonInput(req.body.tagQuery),
        },
      });

      return reply.status(201).send(serializeSuite(suite));
    },
  );

  // GET /suites/:id
  a.get(
    '/suites/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: SuiteShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const suite = await prisma.suite.findUnique({ where: { id: req.params.id } });
      if (!suite) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      return reply.status(200).send(serializeSuite(suite));
    },
  );

  // PATCH /suites/:id
  a.patch(
    '/suites/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          description: z.string().nullable().optional(),
          mode: z.enum(['EXPLICIT', 'TAG_QUERY']).optional(),
          tagQuery: z.record(z.unknown()).nullable().optional(),
          setupTaskId: z.string().nullable().optional(),
          teardownTaskId: z.string().nullable().optional(),
        }),
        response: { 200: SuiteShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update');

      const suite = await prisma.suite.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          // Json column: needs DbNull to clear, so it can't ride along in the spread.
          tagQuery: toJsonInput(req.body.tagQuery),
        },
      });

      return reply.status(200).send(serializeSuite(suite));
    },
  );

  // DELETE /suites/:id
  a.delete(
    '/suites/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:delete');

      await prisma.suite.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );

  // GET /suites/:id/items
  a.get(
    '/suites/:id/items',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(SuiteItemShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const items = await prisma.suiteItem.findMany({
        where: { suiteId: req.params.id },
        orderBy: { position: 'asc' },
      });

      return reply.status(200).send(items);
    },
  );

  // POST /suites/:id/items
  a.post(
    '/suites/:id/items',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          testCaseId: z.string(),
          position: z.number().int().min(0),
        }),
        response: { 201: SuiteItemShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update');

      const existing = await prisma.suiteItem.findUnique({
        where: { suiteId_testCaseId: { suiteId: req.params.id, testCaseId: req.body.testCaseId } },
      });
      if (existing) {
        return reply.status(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'Test case already in suite' } });
      }

      const item = await prisma.suiteItem.create({
        data: {
          suiteId: req.params.id,
          testCaseId: req.body.testCaseId,
          position: req.body.position,
        },
      });

      return reply.status(201).send(item);
    },
  );

  // DELETE /suites/:id/items/:itemId
  a.delete(
    '/suites/:id/items/:itemId',
    {
      schema: {
        params: z.object({ id: z.string(), itemId: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update');

      const item = await prisma.suiteItem.findFirst({
        where: { id: req.params.itemId, suiteId: req.params.id },
      });
      if (!item) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite item not found' } });

      await prisma.suiteItem.delete({ where: { id: req.params.itemId } });
      return reply.status(200).send({ ok: true });
    },
  );

  // PUT /suites/:id/items/reorder
  a.put(
    '/suites/:id/items/reorder',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          items: z.array(z.object({ id: z.string(), position: z.number().int().min(0) })),
        }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getSuiteOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Suite not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update');

      await prisma.$transaction(
        req.body.items.map((item) =>
          prisma.suiteItem.update({
            where: { id: item.id },
            data: { position: item.position },
          }),
        ),
      );

      return reply.status(200).send({ ok: true });
    },
  );

  // ── SCHEDULES ────────────────────────────────────────────────────────────

  // GET /projects/:projectId/schedules
  a.get(
    '/projects/:projectId/schedules',
    {
      schema: {
        params: z.object({ projectId: z.string() }),
        response: { 200: z.array(ScheduleShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const schedules = await prisma.schedule.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(schedules.map(serializeSchedule));
    },
  );

  // POST /projects/:projectId/schedules
  a.post(
    '/projects/:projectId/schedules',
    {
      schema: {
        params: z.object({ projectId: z.string() }),
        body: z.object({
          suiteId: z.string().optional(),
          taskId: z.string().optional(),
          environmentId: z.string(),
          name: z.string().min(1).max(255),
          cron: z.string().min(1),
          timezone: z.string().default('UTC'),
          browsers: z.array(z.enum(['CHROMIUM', 'FIREFOX', 'WEBKIT'])).min(1).default(['CHROMIUM']),
          isEnabled: z.boolean().default(true),
          overlapPolicy: z.enum(['SKIP', 'QUEUE']).default('SKIP'),
        }).refine((d) => d.suiteId ?? d.taskId, { message: 'Either suiteId or taskId must be provided' }),
        response: { 201: ScheduleShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      const schedule = await prisma.schedule.create({
        data: {
          projectId: req.params.projectId,
          suiteId: req.body.suiteId,
          taskId: req.body.taskId,
          environmentId: req.body.environmentId,
          name: req.body.name,
          cron: req.body.cron,
          timezone: req.body.timezone,
          browsers: req.body.browsers,
          isEnabled: req.body.isEnabled,
          overlapPolicy: req.body.overlapPolicy,
        },
      });

      await syncSchedule(schedule);

      return reply.status(201).send(serializeSchedule(schedule));
    },
  );

  // GET /schedules/:id
  a.get(
    '/schedules/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: ScheduleShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id } });
      if (!schedule) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  // PATCH /schedules/:id
  a.patch(
    '/schedules/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          cron: z.string().optional(),
          timezone: z.string().optional(),
          browsers: z.array(z.enum(['CHROMIUM', 'FIREFOX', 'WEBKIT'])).optional(),
          isEnabled: z.boolean().optional(),
          overlapPolicy: z.enum(['SKIP', 'QUEUE']).optional(),
          environmentId: z.string().optional(),
        }),
        response: { 200: ScheduleShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      const schedule = await prisma.schedule.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await syncSchedule(schedule);

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  // DELETE /schedules/:id
  a.delete(
    '/schedules/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      await removeSchedule(req.params.id);
      await prisma.schedule.delete({ where: { id: req.params.id } });

      return reply.status(200).send({ ok: true });
    },
  );

  // POST /schedules/:id/trigger
  a.post(
    '/schedules/:id/trigger',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 201: z.object({ runId: z.string() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      const schedule = await prisma.schedule.findUnique({
        where: { id: req.params.id },
        include: {
          suite: {
            include: { items: { select: { testCaseId: true }, orderBy: { position: 'asc' } } },
          },
        },
      });
      if (!schedule) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      // Check overlap policy
      if (schedule.overlapPolicy === 'SKIP') {
        const running = await prisma.run.findFirst({
          where: { projectId: schedule.projectId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
        });
        if (running) {
          return reply.status(422).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'A run is already active (overlapPolicy=SKIP)' } });
        }
      }

      const testCaseIds = schedule.suite?.items.map((i) => i.testCaseId) ?? [];
      if (testCaseIds.length === 0) {
        return reply.status(422).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'No test cases in suite' } });
      }

      const testCases = await prisma.testCase.findMany({
        where: { id: { in: testCaseIds }, projectId: schedule.projectId, isArchived: false },
        select: { id: true, currentVersionId: true },
      });

      const validTests = testCases.filter((tc) => tc.currentVersionId !== null);
      if (validTests.length === 0) {
        return reply.status(422).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'No valid test cases' } });
      }

      // Stored as Json, but the values are always Prisma `Browser` enum members
      // — validated on write by the schedule create/update routes.
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

        await tx.runShard.create({ data: { runId: r.id, index: 0, total: 1 } });

        const runTestData: {
          runId: string;
          testCaseId: string;
          testVersionId: string;
          shardIndex: number;
          browser: Browser;
          projectLabel: string;
        }[] = [];

        let cursor = 0;
        for (const tc of validTests) {
          for (const browser of browsers) {
            runTestData.push({
              runId: r.id,
              testCaseId: tc.id,
              testVersionId: tc.currentVersionId!,
              shardIndex: cursor % 1,
              browser,
              projectLabel: browser,
            });
            cursor++;
          }
        }

        await tx.runTest.createMany({ data: runTestData });
        return r;
      });

      await enqueueRun(run.id, 0, 1, schedule.projectId);
      await prisma.schedule.update({ where: { id: req.params.id }, data: { lastRunAt: new Date() } });

      return reply.status(201).send({ runId: run.id });
    },
  );

  // POST /schedules/:id/enable
  a.post(
    '/schedules/:id/enable',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: ScheduleShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      const schedule = await prisma.schedule.update({
        where: { id: req.params.id },
        data: { isEnabled: true },
      });

      await syncSchedule(schedule);

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  // POST /schedules/:id/disable
  a.post(
    '/schedules/:id/disable',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: ScheduleShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getScheduleOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Schedule not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'runs:create');

      const schedule = await prisma.schedule.update({
        where: { id: req.params.id },
        data: { isEnabled: false },
      });

      await removeSchedule(req.params.id);

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  // ── INTEGRATIONS ─────────────────────────────────────────────────────────

  // GET /orgs/:orgId/integrations
  a.get(
    '/orgs/:orgId/integrations',
    {
      schema: {
        params: z.object({ orgId: z.string() }),
        response: { 200: z.array(IntegrationShape), 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      const integrations = await prisma.integration.findMany({
        where: { orgId: req.params.orgId },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(integrations.map(serializeIntegration));
    },
  );

  // POST /orgs/:orgId/integrations
  a.post(
    '/orgs/:orgId/integrations',
    {
      schema: {
        params: z.object({ orgId: z.string() }),
        body: z.object({
          type: z.enum(['SLACK', 'EMAIL', 'WEBHOOK', 'GITHUB']),
          name: z.string().min(1).max(255),
          config: z.string().min(1),
          events: z.array(z.string()).min(1),
          projectId: z.string().optional(),
        }),
        response: { 201: IntegrationShape, 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      const envelope = encrypt(req.body.config);
      const configCiphertext = envelopeToBuffer(envelope);

      const integration = await prisma.integration.create({
        data: {
          orgId: req.params.orgId,
          projectId: req.body.projectId,
          type: req.body.type,
          name: req.body.name,
          configCiphertext,
          events: req.body.events,
        },
      });

      return reply.status(201).send(serializeIntegration(integration));
    },
  );

  // GET /integrations/:id
  a.get(
    '/integrations/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: IntegrationShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const integration = await prisma.integration.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!integration) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' } });

      const actor = await resolveActor(req, reply, integration.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      const full = await prisma.integration.findUnique({ where: { id: req.params.id } });
      if (!full) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' } });

      return reply.status(200).send(serializeIntegration(full));
    },
  );

  // PATCH /integrations/:id
  a.patch(
    '/integrations/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          config: z.string().optional(),
          events: z.array(z.string()).optional(),
          isEnabled: z.boolean().optional(),
        }),
        response: { 200: IntegrationShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const existing = await prisma.integration.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!existing) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' } });

      const actor = await resolveActor(req, reply, existing.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      const updateData: {
        name?: string;
        configCiphertext?: Buffer;
        events?: string[];
        isEnabled?: boolean;
        consecutiveFailures?: number;
      } = {};

      if (req.body.name) updateData.name = req.body.name;
      if (req.body.events) updateData.events = req.body.events;
      if (req.body.isEnabled !== undefined) {
        updateData.isEnabled = req.body.isEnabled;
        if (req.body.isEnabled) updateData.consecutiveFailures = 0; // reset on re-enable
      }
      if (req.body.config) {
        updateData.configCiphertext = envelopeToBuffer(encrypt(req.body.config));
      }

      const integration = await prisma.integration.update({
        where: { id: req.params.id },
        data: updateData,
      });

      return reply.status(200).send(serializeIntegration(integration));
    },
  );

  // DELETE /integrations/:id
  a.delete(
    '/integrations/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const existing = await prisma.integration.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!existing) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' } });

      const actor = await resolveActor(req, reply, existing.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      await prisma.integration.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );

  // POST /integrations/:id/test
  a.post(
    '/integrations/:id/test',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ ok: z.boolean() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const existing = await prisma.integration.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!existing) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' } });

      const actor = await resolveActor(req, reply, existing.orgId);
      if (!actor) return;
      authorize(actor, 'integrations:manage');

      try {
        await sendTestNotification(req.params.id);
        return reply.status(200).send({ ok: true });
      } catch (err) {
        return reply.status(422).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: err instanceof Error ? err.message : 'Test notification failed',
          },
        });
      }
    },
  );

  // ── CAPTURE ENDPOINTS ────────────────────────────────────────────────────

  // GET /projects/:id/capture-endpoints
  a.get(
    '/projects/:id/capture-endpoints',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(CaptureEndpointShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const endpoints = await prisma.captureEndpoint.findMany({
        where: { projectId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(endpoints.map(serializeCaptureEndpoint));
    },
  );

  // POST /projects/:id/capture-endpoints
  a.post(
    '/projects/:id/capture-endpoints',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255),
          slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
          secret: z.string().optional(),
          retentionHours: z.number().int().min(1).max(8760).default(72),
        }),
        response: { 201: CaptureEndpointShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'projects:update');

      const existing = await prisma.captureEndpoint.findUnique({
        where: { slug: req.body.slug },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'Slug already taken' } });
      }

      const endpoint = await prisma.captureEndpoint.create({
        data: {
          projectId: req.params.id,
          name: req.body.name,
          slug: req.body.slug,
          secret: req.body.secret,
          retentionHours: req.body.retentionHours,
        },
      });

      return reply.status(201).send(serializeCaptureEndpoint(endpoint));
    },
  );

  // GET /capture-endpoints/:id
  a.get(
    '/capture-endpoints/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: CaptureEndpointShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getCaptureEndpointOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture endpoint not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const endpoint = await prisma.captureEndpoint.findUnique({ where: { id: req.params.id } });
      if (!endpoint) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture endpoint not found' } });

      return reply.status(200).send(serializeCaptureEndpoint(endpoint));
    },
  );

  // DELETE /capture-endpoints/:id
  a.delete(
    '/capture-endpoints/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getCaptureEndpointOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture endpoint not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'projects:update');

      await prisma.captureEndpoint.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );

  // GET /capture-endpoints/:id/events
  a.get(
    '/capture-endpoints/:id/events',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          since: z.string().datetime().optional(),
          match: z.string().optional(),
          runId: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            data: z.array(z.object({
              id: z.string(),
              captureEndpointId: z.string(),
              runId: z.string().nullable(),
              method: z.string(),
              headers: z.unknown(),
              body: z.unknown(),
              sourceIp: z.string().nullable(),
              receivedAt: z.string(),
            })),
            meta: z.object({ page: z.number(), perPage: z.number(), total: z.number() }),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getCaptureEndpointOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture endpoint not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const { since, match, runId, page, perPage } = req.query;

      let matchFilter: Record<string, unknown> | undefined;
      if (match) {
        try {
          matchFilter = JSON.parse(match) as Record<string, unknown>;
        } catch {
          // ignore invalid match JSON
        }
      }

      // One clause per key: a single `path: Object.keys(...)` would be read as a
      // nested path (a → b) rather than "a matches AND b matches", and would
      // compare every key against only the first value.
      const matchClauses: Prisma.CaptureEventWhereInput[] = Object.entries(matchFilter ?? {}).map(
        ([key, value]) => ({ body: { path: [key], equals: value as Prisma.InputJsonValue } }),
      );

      const where: Prisma.CaptureEventWhereInput = {
        captureEndpointId: req.params.id,
        ...(since ? { receivedAt: { gte: new Date(since) } } : {}),
        ...(runId ? { runId } : {}),
        ...(matchClauses.length > 0 ? { AND: matchClauses } : {}),
      };

      const [events, total] = await Promise.all([
        prisma.captureEvent.findMany({
          where,
          orderBy: { receivedAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          select: {
            id: true,
            captureEndpointId: true,
            runId: true,
            method: true,
            headers: true,
            body: true,
            sourceIp: true,
            receivedAt: true,
          },
        }),
        prisma.captureEvent.count({ where }),
      ]);

      return reply.status(200).send({
        data: events.map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })),
        meta: { page, perPage, total },
      });
    },
  );

  // ── TASKS ────────────────────────────────────────────────────────────────

  // GET /projects/:id/tasks
  a.get(
    '/projects/:id/tasks',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(TaskShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const tasks = await prisma.task.findMany({
        where: { projectId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(tasks.map(serializeTask));
    },
  );

  // POST /projects/:id/tasks
  a.post(
    '/projects/:id/tasks',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255),
          kind: z.enum(['CLEANUP', 'SEED', 'CUSTOM']).default('CUSTOM'),
          code: z.string().min(1),
          environmentId: z.string(),
          timeoutMs: z.number().int().min(1000).max(600_000).optional(),
        }),
        response: { 201: TaskShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:create');

      const task = await prisma.task.create({
        data: {
          projectId: req.params.id,
          environmentId: req.body.environmentId,
          name: req.body.name,
          kind: req.body.kind,
          code: req.body.code,
          timeoutMs: req.body.timeoutMs ?? 120_000,
        },
      });

      return reply.status(201).send(serializeTask(task));
    },
  );

  // GET /tasks/:id
  a.get(
    '/tasks/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: TaskShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTaskOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const task = await prisma.task.findUnique({ where: { id: req.params.id } });
      if (!task) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' } });

      return reply.status(200).send(serializeTask(task));
    },
  );

  // PATCH /tasks/:id
  a.patch(
    '/tasks/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          kind: z.enum(['CLEANUP', 'SEED', 'CUSTOM']).optional(),
          code: z.string().optional(),
          environmentId: z.string().optional(),
          timeoutMs: z.number().int().optional(),
          isEnabled: z.boolean().optional(),
        }),
        response: { 200: TaskShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTaskOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update');

      const task = await prisma.task.update({
        where: { id: req.params.id },
        data: req.body,
      });

      return reply.status(200).send(serializeTask(task));
    },
  );

  // DELETE /tasks/:id
  a.delete(
    '/tasks/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTaskOrgId(req.params.id);
      if (!orgId) return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' } });

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:delete');

      await prisma.task.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC HOOK ROUTES — mount at app root, NOT under /api/v1
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mount this at the root level (no prefix) in server.ts:
 *   await app.register(hookRoutes);
 */
export async function hookRoutes(app: FastifyInstance): Promise<void> {
  // Body size limit: 1 MB for all routes in this plugin
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1_048_576 },
    (_req, body, done) => {
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch {
        done(null, null);
      }
    },
  );

  // POST /hooks/c/:slug — public, rate-limited, always 202
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/hooks/c/:slug',
    {
      config: {
        // Rate limiting hint for @fastify/rate-limit if globally registered
        rateLimit: { max: 100, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const { slug } = req.params;

      const endpoint = await prisma.captureEndpoint.findUnique({
        where: { slug },
        select: { id: true, isEnabled: true, secret: true },
      });

      // Always return 202 regardless — don't leak info about endpoint existence
      if (!endpoint || !endpoint.isEnabled) {
        return reply.status(202).send({ ok: true });
      }

      // If endpoint has a secret, validate HMAC signature
      if (endpoint.secret) {
        const signature = req.headers['x-sentinel-signature'] as string | undefined;
        const timestamp = req.headers['x-sentinel-timestamp'] as string | undefined;

        if (!signature || !timestamp) {
          // Accept but don't record if signature is missing (fail silently per spec)
          return reply.status(202).send({ ok: true });
        }

        const bodyStr = JSON.stringify(req.body ?? {});
        const expected = createHmac('sha256', endpoint.secret)
          .update(`${timestamp}.${bodyStr}`)
          .digest('hex');

        if (`sha256=${expected}` !== signature) {
          return reply.status(202).send({ ok: true });
        }
      }

      // Store the capture event (non-blocking)
      prisma.captureEvent
        .create({
          data: {
            captureEndpointId: endpoint.id,
            method: req.method,
            headers: req.headers as Prisma.InputJsonValue,
            body: toJsonInput(req.body != null ? (req.body as Record<string, unknown>) : undefined),
            rawBody: Buffer.from(JSON.stringify(req.body ?? {})),
            sourceIp: req.ip,
          },
        })
        .catch(() => {});

      return reply.status(202).send({ ok: true });
    },
  );
}
