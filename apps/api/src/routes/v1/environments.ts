import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES, CreateEnvironmentSchema } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { encrypt, decrypt, envelopeToBuffer, bufferToEnvelope } from '../../services/encryption.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const EnvShape = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  isDefault: z.boolean(),
  variables: z.record(z.string()),
  httpCredentials: z.unknown().nullable(),
  secretKeys: z.array(z.string()), // key names only — values are never returned
  createdAt: z.string(),
  updatedAt: z.string(),
});

function getSecretKeys(ciphertext: Buffer | Uint8Array | null): string[] {
  if (!ciphertext) return [];
  try {
    const envelope = bufferToEnvelope(ciphertext);
    const raw = decrypt(envelope);
    return Object.keys(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function serializeEnv(
  env: {
    id: string;
    projectId: string;
    name: string;
    baseUrl: string;
    isDefault: boolean;
    variables: unknown;
    httpCredentials: unknown;
    secretsCiphertext: Buffer | Uint8Array | null;
    createdAt: Date;
    updatedAt: Date;
  },
  secretKeys?: string[],
) {
  return {
    id: env.id,
    projectId: env.projectId,
    name: env.name,
    baseUrl: env.baseUrl,
    isDefault: env.isDefault,
    variables: (env.variables ?? {}) as Record<string, string>,
    httpCredentials: env.httpCredentials ?? null,
    secretKeys: secretKeys ?? getSecretKeys(env.secretsCiphertext ?? null),
    createdAt: env.createdAt.toISOString(),
    updatedAt: env.updatedAt.toISOString(),
  };
}

export async function environmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();


  // Resolve project slug to actual cuid before any handler
  a.addHook('preHandler', async (req) => {
    const p = req.params as Record<string, string>;
    for (const key of ['id', 'projectId']) {
      if (p[key] && !/^c[a-z0-9]{24,}/.test(p[key])) {
        const proj = await prisma.project.findFirst({ where: { slug: p[key] }, select: { id: true } });
        if (proj) p[key] = proj.id;
      }
    }
  });

  // ── GET /projects/:id/environments ────────────────────────────────────────
  a.get(
    '/projects/:id/environments',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(EnvShape), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const envs = await prisma.environment.findMany({
        where: { projectId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(envs.map((e) => serializeEnv(e)));
    },
  );

  // ── POST /projects/:id/environments ───────────────────────────────────────
  a.post(
    '/projects/:id/environments',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: CreateEnvironmentSchema,
        response: { 201: EnvShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'environments:create');

      // Check name uniqueness within project
      const existing = await prisma.environment.findUnique({
        where: { projectId_name: { projectId: req.params.id, name: req.body.name } },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'Environment name already taken in this project' },
        });
      }

      const { secrets, ...rest } = req.body;
      let secretsCiphertext: Buffer | undefined;
      let secretKeys: string[] = [];

      if (secrets && Object.keys(secrets).length > 0) {
        secretKeys = Object.keys(secrets);
        secretsCiphertext = envelopeToBuffer(encrypt(JSON.stringify(secrets)));
      }

      const env = await prisma.environment.create({
        data: {
          projectId: req.params.id,
          name: rest.name,
          baseUrl: rest.baseUrl,
          isDefault: rest.isDefault ?? false,
          variables: rest.variables ?? {},
          httpCredentials: rest.httpCredentials ?? undefined,
          secretsCiphertext,
        },
      });

      return reply.status(201).send(serializeEnv(env, secretKeys));
    },
  );

  // ── GET /projects/:projectId/environments/:id ──────────────────────────────
  a.get(
    '/projects/:projectId/environments/:id',
    {
      schema: {
        params: z.object({ projectId: z.string(), id: z.string() }),
        response: { 200: EnvShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const env = await prisma.environment.findFirst({
        where: { id: req.params.id, projectId: req.params.projectId },
      });
      if (!env) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Environment not found' } });
      }

      return reply.status(200).send(serializeEnv(env));
    },
  );

  // ── PATCH /projects/:projectId/environments/:id ────────────────────────────
  a.patch(
    '/projects/:projectId/environments/:id',
    {
      schema: {
        params: z.object({ projectId: z.string(), id: z.string() }),
        body: CreateEnvironmentSchema.partial(),
        response: { 200: EnvShape, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'environments:update');

      const env = await prisma.environment.findFirst({
        where: { id: req.params.id, projectId: req.params.projectId },
      });
      if (!env) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Environment not found' } });
      }

      const { secrets, ...rest } = req.body;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = { ...rest };
      let secretKeys: string[] | undefined;

      if (secrets !== undefined) {
        if (Object.keys(secrets).length > 0) {
          secretKeys = Object.keys(secrets);
          data['secretsCiphertext'] = envelopeToBuffer(encrypt(JSON.stringify(secrets)));
        } else {
          data['secretsCiphertext'] = null;
          secretKeys = [];
        }
      }

      const updated = await prisma.environment.update({
        where: { id: req.params.id },
        data,
      });

      return reply.status(200).send(serializeEnv(updated, secretKeys));
    },
  );

  // ── DELETE /projects/:projectId/environments/:id ───────────────────────────
  a.delete(
    '/projects/:projectId/environments/:id',
    {
      schema: {
        params: z.object({ projectId: z.string(), id: z.string() }),
        response: {
          200: z.object({ ok: z.boolean() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.projectId);
      if (!orgId) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' } });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'environments:delete');

      const env = await prisma.environment.findFirst({
        where: { id: req.params.id, projectId: req.params.projectId },
        select: { id: true },
      });
      if (!env) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Environment not found' } });
      }

      await prisma.environment.delete({ where: { id: req.params.id } });
      return reply.status(200).send({ ok: true });
    },
  );
}
