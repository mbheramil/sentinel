/**
 * baselineRoutes.ts — Phase 6 Part C
 *
 * Visual regression baseline management.
 * Mount at /api/v1 in server.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getTestCaseOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { config } from '../../config.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const BaselineShape = z.object({
  id: z.string(),
  testCaseId: z.string(),
  name: z.string(),
  browser: z.string(),
  storageKey: z.string(),
  thumbnailUrl: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

async function presignBaseline(storageKey: string): Promise<string | null> {
  try {
    const command = new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey });
    return await getSignedUrl(getS3(), command, { expiresIn: 3600 });
  } catch {
    return null;
  }
}

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /tests/:id/baselines ─────────────────────────────────────────────
  a.get(
    '/tests/:id/baselines',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.array(BaselineShape),
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
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Test case not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      const baselines = await prisma.visualBaseline.findMany({
        where: { testCaseId: req.params.id },
        orderBy: [{ browser: 'asc' }, { name: 'asc' }],
      });

      const withUrls = await Promise.all(
        baselines.map(async (b) => ({
          id: b.id,
          testCaseId: b.testCaseId,
          name: b.name,
          browser: String(b.browser),
          storageKey: b.storageKey,
          thumbnailUrl: await presignBaseline(b.storageKey),
          approvedAt: b.approvedAt?.toISOString() ?? null,
          approvedBy: b.approvedBy ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
      );

      return reply.status(200).send(withUrls);
    },
  );

  // ── POST /tests/:id/baselines/:baselineId/approve ────────────────────────
  a.post(
    '/tests/:id/baselines/:baselineId/approve',
    {
      schema: {
        params: z.object({ id: z.string(), baselineId: z.string() }),
        response: {
          200: BaselineShape,
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
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Test case not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:update'); // EDITOR+

      const baseline = await prisma.visualBaseline.findFirst({
        where: { id: req.params.baselineId, testCaseId: req.params.id },
      });

      if (!baseline) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Baseline not found' },
        });
      }

      const updated = await prisma.visualBaseline.update({
        where: { id: req.params.baselineId },
        data: {
          approvedAt: new Date(),
          approvedBy: actor.userId ?? 'api-key',
        },
      });

      return reply.status(200).send({
        id: updated.id,
        testCaseId: updated.testCaseId,
        name: updated.name,
        browser: String(updated.browser),
        storageKey: updated.storageKey,
        thumbnailUrl: await presignBaseline(updated.storageKey),
        approvedAt: updated.approvedAt?.toISOString() ?? null,
        approvedBy: updated.approvedBy ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    },
  );

  // ── DELETE /tests/:id/baselines/:baselineId ──────────────────────────────
  a.delete(
    '/tests/:id/baselines/:baselineId',
    {
      schema: {
        params: z.object({ id: z.string(), baselineId: z.string() }),
        response: {
          200: z.object({ ok: z.boolean() }),
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
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Test case not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:delete'); // EDITOR+

      const baseline = await prisma.visualBaseline.findFirst({
        where: { id: req.params.baselineId, testCaseId: req.params.id },
      });

      if (!baseline) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Baseline not found' },
        });
      }

      await prisma.visualBaseline.delete({ where: { id: req.params.baselineId } });
      return reply.status(200).send({ ok: true });
    },
  );
}
