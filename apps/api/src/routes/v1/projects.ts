import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES, CreateProjectSchema } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const ProjectShape = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  defaultBrowsers: z.array(z.string()),
  defaultTimeoutMs: z.number(),
  defaultRetries: z.number(),
  defaultExpectTimeoutMs: z.number(),
  concurrency: z.number(),
  artifactRetentionDays: z.number(),
  failOnConsoleError: z.boolean(),
  failOnNetworkError: z.boolean(),
  diagnosticsIgnore: z.array(z.string()),
  testDataPrefix: z.string(),
  testEmailLocal: z.string().nullable(),
  testEmailDomain: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function serializeProject(p: {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  defaultBrowsers: string[];
  defaultTimeoutMs: number;
  defaultRetries: number;
  defaultExpectTimeoutMs: number;
  concurrency: number;
  artifactRetentionDays: number;
  failOnConsoleError: boolean;
  failOnNetworkError: boolean;
  diagnosticsIgnore: string[];
  testDataPrefix: string;
  testEmailLocal: string | null;
  testEmailDomain: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /projects ──────────────────────────────────────────────────────────
  a.get(
    '/projects',
    {
      schema: {
        querystring: z.object({ orgId: z.string().optional() }),
        response: { 200: z.array(ProjectShape), 401: ErrorSchema },
      },
    },
    async (req, reply) => {
      if (!req.identity) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      let orgIds: string[];
      if (req.identity.type === 'apiKey') {
        orgIds = [req.identity.orgId!];
      } else {
        const memberships = await prisma.membership.findMany({
          where: { userId: req.identity.userId! },
          select: { orgId: true },
        });
        orgIds = memberships.map((m) => m.orgId);
      }

      if (req.query.orgId) {
        if (!orgIds.includes(req.query.orgId)) return reply.status(200).send([]);
        orgIds = [req.query.orgId];
      }

      const projects = await prisma.project.findMany({
        where: { orgId: { in: orgIds } },
        orderBy: { createdAt: 'desc' },
      });

      return reply.status(200).send(projects.map(serializeProject));
    },
  );

  // ── POST /projects ─────────────────────────────────────────────────────────
  a.post(
    '/projects',
    {
      schema: {
        body: CreateProjectSchema.extend({ orgId: z.string().min(1) }),
        response: { 201: ProjectShape, 401: ErrorSchema, 403: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, ...data } = req.body;

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'projects:create');

      const existing = await prisma.project.findUnique({
        where: { orgId_slug: { orgId, slug: data.slug } },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'Project slug already taken in this organisation' },
        });
      }

      const project = await prisma.project.create({ data: { orgId, ...data } });
      return reply.status(201).send(serializeProject(project));
    },
  );

  // ── GET /projects/:id ──────────────────────────────────────────────────────
  a.get(
    '/projects/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: ProjectShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' },
        });
      }

      const actor = await resolveActor(req, reply, project.orgId);
      if (!actor) return;

      return reply.status(200).send(serializeProject(project));
    },
  );

  // ── PATCH /projects/:id ────────────────────────────────────────────────────
  a.patch(
    '/projects/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: CreateProjectSchema.partial(),
        response: { 200: ProjectShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const project = await prisma.project.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!project) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' },
        });
      }

      const actor = await resolveActor(req, reply, project.orgId);
      if (!actor) return;

      authorize(actor, 'projects:update');

      const updated = await prisma.project.update({
        where: { id: req.params.id },
        data: req.body,
      });

      return reply.status(200).send(serializeProject(updated));
    },
  );

  // ── DELETE /projects/:id ───────────────────────────────────────────────────
  a.delete(
    '/projects/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ ok: z.boolean() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await prisma.project.findUnique({
        where: { id: req.params.id },
        select: { orgId: true },
      });
      if (!project) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' },
        });
      }

      const actor = await resolveActor(req, reply, project.orgId);
      if (!actor) return;

      authorize(actor, 'projects:delete');

      await prisma.project.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );
}
