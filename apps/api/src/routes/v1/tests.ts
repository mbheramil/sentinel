import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma, Prisma } from '@sentinel/db';
import {
  ERROR_CODES,
  CreateTestCaseSchema,
  UpdateTestCaseSchema,
  CreateTestVersionSchema,
  BLOCKED_PATTERNS,
  WARNED_PATTERNS,
} from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId, getTestCaseOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const TestShape = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  authoringMode: z.string(),
  filePath: z.string(),
  code: z.string(),
  stepsIr: z.unknown().nullable(),
  tags: z.array(z.string()),
  isMuted: z.boolean(),
  isArchived: z.boolean(),
  currentVersionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const VersionShape = z.object({
  id: z.string(),
  testCaseId: z.string(),
  version: z.number(),
  code: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
});

const DiagnosticSchema = z.object({
  line: z.number(),
  col: z.number(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});

function serializeTest(t: {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  authoringMode: string;
  filePath: string;
  code: string;
  stepsIr?: unknown;
  tags: string[];
  isMuted: boolean;
  isArchived: boolean;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...t,
    stepsIr: t.stepsIr ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function testRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();


  // Resolve project slug to actual cuid
  a.addHook('preHandler', async (req) => {
    const p = req.params as Record<string, string>;
    for (const key of ['id', 'projectId']) {
      if (p[key] && !/^c[a-z0-9]{24,}/.test(p[key])) {
        const proj = await prisma.project.findFirst({ where: { slug: p[key] }, select: { id: true } });
        if (proj) p[key] = proj.id;
      }
    }
  });

  // ── GET /projects/:id/tests ────────────────────────────────────────────────
  a.get(
    '/projects/:id/tests',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({
          tag: z.string().optional(),
          q: z.string().optional(),
          archived: z
            .string()
            .optional()
            .transform((v) => v === 'true'),
        }),
        response: { 200: z.array(TestShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const { tag, q, archived } = req.query;

      const tests = await prisma.testCase.findMany({
        where: {
          projectId: req.params.id,
          isArchived: archived ?? false,
          ...(tag ? { tags: { has: tag } } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { filePath: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.status(200).send(tests.map(serializeTest));
    },
  );

  // ── POST /projects/:id/tests ───────────────────────────────────────────────
  a.post(
    '/projects/:id/tests',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: CreateTestCaseSchema,
        response: { 201: TestShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:create');

      const existing = await prisma.testCase.findUnique({
        where: { projectId_filePath: { projectId: req.params.id, filePath: req.body.filePath } },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'A test with this file path already exists' },
        });
      }

      // Create the test case and its initial version in one transaction so
      // currentVersionId is set immediately. Without a version the runner skips
      // the test (it filters to currentVersionId != null) and Quick Run reports
      // 0 tests.
      const test = await prisma.$transaction(async (tx) => {
        const tc = await tx.testCase.create({
          data: {
            projectId: req.params.id,
            name: req.body.name,
            description: req.body.description,
            filePath: req.body.filePath,
            code: req.body.code,
            stepsIr: req.body.stepsIr ?? undefined,
            authoringMode: req.body.authoringMode,
            tags: req.body.tags,
          },
        });

        const version = await tx.testVersion.create({
          data: {
            testCaseId: tc.id,
            version: 1,
            code: req.body.code,
            message: 'Initial version',
          },
        });

        return tx.testCase.update({
          where: { id: tc.id },
          data: { currentVersionId: version.id },
        });
      });

      return reply.status(201).send(serializeTest(test));
    },
  );

  // ── GET /tests/:id ─────────────────────────────────────────────────────────
  a.get(
    '/tests/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: TestShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const test = await prisma.testCase.findUnique({ where: { id: req.params.id } });
      if (!test) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      return reply.status(200).send(serializeTest(test));
    },
  );

  // ── PATCH /tests/:id ───────────────────────────────────────────────────────
  a.patch(
    '/tests/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: UpdateTestCaseSchema,
        response: { 200: TestShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:update');

      const updated = await prisma.testCase.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.filePath !== undefined ? { filePath: req.body.filePath } : {}),
          ...(req.body.code !== undefined ? { code: req.body.code } : {}),
          // `stepsIr` is a nullable Json column: clearing it needs Prisma.DbNull,
          // not a bare `null` (which Prisma reads as "no change").
          ...(req.body.stepsIr !== undefined
            ? { stepsIr: req.body.stepsIr === null ? Prisma.DbNull : (req.body.stepsIr as Prisma.InputJsonValue) }
            : {}),
          ...(req.body.authoringMode !== undefined ? { authoringMode: req.body.authoringMode } : {}),
          ...(req.body.tags !== undefined ? { tags: req.body.tags } : {}),
          ...(req.body.isMuted !== undefined ? { isMuted: req.body.isMuted } : {}),
          ...(req.body.isArchived !== undefined ? { isArchived: req.body.isArchived } : {}),
        },
      });

      return reply.status(200).send(serializeTest(updated));
    },
  );

  // ── DELETE /tests/:id ──────────────────────────────────────────────────────
  a.delete(
    '/tests/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:delete');

      await prisma.testCase.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );

  // ── POST /tests/:id/versions ───────────────────────────────────────────────
  a.post(
    '/tests/:id/versions',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: CreateTestVersionSchema,
        response: { 201: VersionShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:update');

      // Determine the next version number
      const latest = await prisma.testVersion.findFirst({
        where: { testCaseId: req.params.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      const version = await prisma.$transaction(async (tx) => {
        const v = await tx.testVersion.create({
          data: {
            testCaseId: req.params.id,
            version: nextVersion,
            code: req.body.code,
            stepsIr: req.body.stepsIr ?? undefined,
            message: req.body.message,
            createdByUserId: actor.userId ?? undefined,
          },
        });
        // Update test to point to latest version and snapshot code
        await tx.testCase.update({
          where: { id: req.params.id },
          data: { currentVersionId: v.id, code: req.body.code },
        });
        return v;
      });

      return reply.status(201).send({
        id: version.id,
        testCaseId: version.testCaseId,
        version: version.version,
        code: version.code,
        message: version.message,
        createdAt: version.createdAt.toISOString(),
      });
    },
  );

  // ── GET /tests/:id/versions ────────────────────────────────────────────────
  a.get(
    '/tests/:id/versions',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(VersionShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const versions = await prisma.testVersion.findMany({
        where: { testCaseId: req.params.id },
        orderBy: { version: 'desc' },
        select: { id: true, testCaseId: true, version: true, code: true, message: true, createdAt: true },
      });

      return reply.status(200).send(
        versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      );
    },
  );

  // ── GET /tests/:id/versions/:v ─────────────────────────────────────────────
  a.get(
    '/tests/:id/versions/:v',
    {
      schema: {
        params: z.object({ id: z.string(), v: z.coerce.number().int() }),
        response: { 200: VersionShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const version = await prisma.testVersion.findUnique({
        where: { testCaseId_version: { testCaseId: req.params.id, version: req.params.v } },
        select: { id: true, testCaseId: true, version: true, code: true, message: true, createdAt: true },
      });
      if (!version) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Version not found' } });
      }

      return reply.status(200).send({ ...version, createdAt: version.createdAt.toISOString() });
    },
  );

  // ── POST /tests/:id/restore/:v ─────────────────────────────────────────────
  a.post(
    '/tests/:id/restore/:v',
    {
      schema: {
        params: z.object({ id: z.string(), v: z.coerce.number().int() }),
        response: { 200: TestShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:update');

      const targetVersion = await prisma.testVersion.findUnique({
        where: { testCaseId_version: { testCaseId: req.params.id, version: req.params.v } },
      });
      if (!targetVersion) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Version not found' } });
      }

      // Create a new version that is a copy of the target
      const latest = await prisma.testVersion.findFirst({
        where: { testCaseId: req.params.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      const restored = await prisma.$transaction(async (tx) => {
        const v = await tx.testVersion.create({
          data: {
            testCaseId: req.params.id,
            version: nextVersion,
            code: targetVersion.code,
            stepsIr: targetVersion.stepsIr ?? undefined,
            message: `Restored from v${req.params.v}`,
            createdByUserId: actor.userId ?? undefined,
          },
        });
        return tx.testCase.update({
          where: { id: req.params.id },
          data: { currentVersionId: v.id, code: targetVersion.code },
        });
      });

      return reply.status(200).send(serializeTest(restored));
    },
  );

  // ── POST /tests/:id/validate ───────────────────────────────────────────────
  a.post(
    '/tests/:id/validate',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ code: z.string().optional() }).optional(),
        response: {
          200: z.object({
            valid: z.boolean(),
            diagnostics: z.array(DiagnosticSchema),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getTestCaseOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      // Use the provided code or fall back to stored code
      let code: string;
      if (req.body?.code) {
        code = req.body.code;
      } else {
        const test = await prisma.testCase.findUnique({
          where: { id: req.params.id },
          select: { code: true },
        });
        if (!test) {
          return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Test not found' } });
        }
        code = test.code;
      }

      const diagnostics: Array<{ line: number; col: number; message: string; severity: 'error' | 'warning' }> = [];

      // Blocklist check — scan each line for forbidden patterns
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const pattern of BLOCKED_PATTERNS) {
          if (pattern.test(line)) {
            diagnostics.push({
              line: i + 1,
              col: 1,
              message: `Forbidden pattern detected: ${pattern.toString()}`,
              severity: 'error',
            });
          }
        }
        // Warning patterns
        for (const { pattern, message } of WARNED_PATTERNS) {
          if (pattern.test(line)) {
            diagnostics.push({ line: i + 1, col: 1, message, severity: 'warning' });
          }
        }
      }

      const valid = diagnostics.every((d) => d.severity !== 'error');
      return reply.status(200).send({ valid, diagnostics });
    },
  );
}
