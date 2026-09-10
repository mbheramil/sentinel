import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '@sentinel/db';
import { ERROR_CODES, API_KEY_PREFIX_LENGTH, API_KEY_BYTES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const ApiKeyListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /orgs/:id/api-keys ─────────────────────────────────────────────────
  a.get(
    '/orgs/:id/api-keys',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(ApiKeyListItemSchema), 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'apiKeys:list');

      const keys = await prisma.apiKey.findMany({
        where: { orgId: req.params.id },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          // hash is intentionally excluded
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.status(200).send(
        keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          expiresAt: k.expiresAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        })),
      );
    },
  );

  // ── POST /orgs/:id/api-keys ────────────────────────────────────────────────
  a.post(
    '/orgs/:id/api-keys',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(255),
          scopes: z.array(z.string()).default([]),
          expiresAt: z.string().datetime().optional(),
        }),
        response: {
          201: z.object({
            id: z.string(),
            name: z.string(),
            prefix: z.string(),
            key: z.string(), // full raw key — returned ONCE ONLY
            scopes: z.array(z.string()),
            createdAt: z.string(),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'apiKeys:create');

      // Generate 32 cryptographically random bytes → base64url → prefix with sk_live_
      const rawBytes = randomBytes(API_KEY_BYTES);
      const fullKey = `sk_live_${rawBytes.toString('base64url')}`;
      const prefix = fullKey.slice(0, API_KEY_PREFIX_LENGTH); // first 12 chars as lookup index

      // argon2id hash of the full key — this is what we store
      const hash = await argon2.hash(fullKey, { type: argon2.argon2id });

      const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;

      const apiKey = await prisma.apiKey.create({
        data: {
          orgId: req.params.id,
          createdById: actor.userId ?? undefined,
          name: req.body.name,
          prefix,
          hash,
          scopes: req.body.scopes,
          expiresAt,
        },
        select: { id: true, name: true, prefix: true, scopes: true, createdAt: true },
      });

      return reply.status(201).send({
        ...apiKey,
        key: fullKey,
        createdAt: apiKey.createdAt.toISOString(),
      });
    },
  );

  // ── DELETE /orgs/:id/api-keys/:keyId ──────────────────────────────────────
  a.delete(
    '/orgs/:id/api-keys/:keyId',
    {
      schema: {
        params: z.object({ id: z.string(), keyId: z.string() }),
        response: {
          200: z.object({ ok: z.boolean() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'apiKeys:revoke');

      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.keyId, orgId: req.params.id },
        select: { id: true, revokedAt: true },
      });

      if (!key) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'API key not found' },
        });
      }

      await prisma.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
      });

      return reply.status(200).send({ ok: true });
    },
  );
}
