import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@sentinel/db';
import type { Browser } from '@sentinel/db';
import { ERROR_CODES, SentinelEventSchema } from '@sentinel/shared';
import { config } from '../../config.js';
import { decrypt, bufferToEnvelope } from '../../services/encryption.js';
import { getRedis } from '../../lib/redis.js';
import { logger } from '../../logger.js';
import { computeTestStats } from '../../services/flakeScorer.js';
import { aggregateRunShards } from '../../services/shardAggregator.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** Verify the RUNNER_TOKEN header; reject if missing or wrong. */
async function runnerAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.headers['x-runner-token'];
  if (!token || token !== config.RUNNER_TOKEN) {
    await reply.status(401).send({
      error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Invalid runner token' },
    });
  }
}

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

type RunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELED' | 'ERROR' | 'TIMED_OUT';
type TestStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'FLAKY' | 'SKIPPED' | 'TIMED_OUT';

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', runnerAuth);

  // Accept NDJSON bodies as raw strings so the events endpoint can parse lines individually
  app.addContentTypeParser(
    ['application/x-ndjson', 'application/ndjson', 'text/plain'],
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /shards/:id/claim ─────────────────────────────────────────────────
  a.post(
    '/shards/:id/claim',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ runnerId: z.string() }),
        response: {
          200: z.object({
            runId: z.string(),
            shortId: z.string(),
            shardId: z.string(),
            shardIndex: z.number(),
            shardTotal: z.number(),
            browsers: z.array(z.string()),
            traceMode: z.string(),
            workers: z.number(),
            environment: z.object({
              baseUrl: z.string(),
              vars: z.record(z.string()),
              secrets: z.record(z.string()),
            }),
            tests: z.array(
              z.object({
                runTestId: z.string(),
                testCaseId: z.string(),
                name: z.string(),
                filePath: z.string(),
                code: z.string(),
                browser: z.string(),
                projectLabel: z.string(),
              }),
            ),
          }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const shard = await prisma.runShard.findUnique({
        where: { id: req.params.id },
        include: {
          run: {
            include: {
              environment: true,
              runTests: {
                include: {
                  testCase: { select: { id: true, name: true, filePath: true, code: true } },
                },
              },
            },
          },
        },
      });

      if (!shard) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Shard not found' } });
      }
      if (shard.status !== 'QUEUED') {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: `Shard is already ${shard.status}` },
        });
      }

      // Mark shard as claimed
      await prisma.runShard.update({
        where: { id: shard.id },
        data: {
          status: 'RUNNING',
          claimedAt: new Date(),
          heartbeatAt: new Date(),
          runnerId: req.body.runnerId,
          attemptCount: { increment: 1 },
        },
      });

      // Update run to RUNNING if still QUEUED
      await prisma.run.updateMany({
        where: { id: shard.runId, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      // Decrypt environment secrets
      const env = shard.run.environment;
      let secrets: Record<string, string> = {};
      if (env.secretsCiphertext) {
        try {
          const envelope = bufferToEnvelope(env.secretsCiphertext);
          secrets = JSON.parse(decrypt(envelope)) as Record<string, string>;
        } catch (err) {
          logger.error({ err, envId: env.id }, 'Failed to decrypt environment secrets');
        }
      }

      // Filter run tests for this shard
      const shardTests = shard.run.runTests.filter((rt) => rt.shardIndex === shard.index);

      return reply.status(200).send({
        runId: shard.runId,
        shortId: shard.runId.slice(-8),
        shardId: shard.id,
        shardIndex: shard.index,
        shardTotal: shard.total,
        browsers: shard.run.browsers,
        traceMode: shard.run.traceMode,
        workers: 1,
        environment: {
          baseUrl: env.baseUrl,
          vars: (env.variables ?? {}) as Record<string, string>,
          secrets,
        },
        tests: shardTests.map((rt) => ({
          runTestId: rt.id,
          testCaseId: rt.testCase.id,
          name: rt.testCase.name,
          filePath: rt.testCase.filePath,
          code: rt.testCase.code,
          browser: rt.browser,
          projectLabel: rt.projectLabel,
        })),
      });
    },
  );

  // ── POST /shards/:id/heartbeat ─────────────────────────────────────────────
  a.post(
    '/shards/:id/heartbeat',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const shard = await prisma.runShard.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!shard) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Shard not found' } });
      }

      await prisma.runShard.update({
        where: { id: shard.id },
        data: { heartbeatAt: new Date() },
      });

      return reply.status(200).send({ ok: true });
    },
  );

  // ── POST /runs/:id/events ──────────────────────────────────────────────────
  // Accepts NDJSON body (one SentinelEvent JSON per line).
  a.post(
    '/runs/:id/events',
    {
      config: { rawBody: true },
      schema: {
        params: z.object({ id: z.string() }),
        // body is raw NDJSON — no Zod schema here; we parse manually
        response: { 202: z.object({ accepted: z.number() }), 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const run = await prisma.run.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!run) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' } });
      }

      // Parse NDJSON body
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const lines = body.split('\n').filter((l) => l.trim().length > 0);

      const redis = getRedis();
      let accepted = 0;

      for (const line of lines) {
        let evt: unknown;
        try {
          evt = JSON.parse(line);
        } catch {
          continue; // skip malformed lines
        }

        const parsed = SentinelEventSchema.safeParse(evt);
        if (!parsed.success) continue;

        const { seq, ts, shardIndex, type, payload } = parsed.data;

        // Upsert — idempotent on (runId, shardIndex, seq)
        try {
          await prisma.runEvent.upsert({
            where: { runId_shardIndex_seq: { runId: req.params.id, shardIndex, seq } },
            create: {
              runId: req.params.id,
              shardIndex,
              seq,
              type,
              ts: new Date(ts),
              payload: payload as object,
            },
            update: {}, // no-op on duplicate — idempotent
          });
        } catch {
          continue;
        }

        // Publish to Redis for SSE live tailing
        const message = JSON.stringify({ seq, type, ts, shardIndex, payload });
        redis.publish(`run:${req.params.id}`, message).catch(() => {});

        accepted++;
      }

      return reply.status(202).send({ accepted });
    },
  );

  // ── POST /attempts/:id/artifacts/presign ──────────────────────────────────
  a.post(
    '/attempts/:id/artifacts/presign',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          kind: z.string(),
          contentType: z.string(),
          sizeBytes: z.number().int().positive(),
          label: z.string().optional(),
        }),
        response: {
          200: z.object({ uploadUrl: z.string(), storageKey: z.string(), expiresIn: z.number() }),
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const attempt = await prisma.attempt.findUnique({
        where: { id: req.params.id },
        select: { id: true, runTest: { select: { runId: true } } },
      });
      if (!attempt) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' } });
      }

      const runId = attempt.runTest.runId;
      const storageKey = `runs/${runId}/attempts/${req.params.id}/${Date.now()}-${req.body.kind}`;

      const command = new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: storageKey,
        ContentType: req.body.contentType,
        ContentLength: req.body.sizeBytes,
      });

      const expiresIn = 3600; // 1 hour
      const uploadUrl = await getSignedUrl(getS3(), command, { expiresIn });

      return reply.status(200).send({ uploadUrl, storageKey, expiresIn });
    },
  );

  // ── PATCH /shards/:id/complete ─────────────────────────────────────────────
  a.patch(
    '/shards/:id/complete',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          status: z.enum(['PASSED', 'FAILED', 'ERROR', 'CANCELED', 'TIMED_OUT']),
          testResults: z.array(
            z.object({
              runTestId: z.string(),
              status: z.enum(['PASSED', 'FAILED', 'FLAKY', 'SKIPPED', 'TIMED_OUT']),
              durationMs: z.number().int().optional(),
            }),
          ),
        }),
        response: { 200: z.object({ ok: z.boolean() }), 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const shard = await prisma.runShard.findUnique({
        where: { id: req.params.id },
        select: { id: true, runId: true },
      });
      if (!shard) {
        return reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Shard not found' } });
      }

      // Update individual test statuses
      await Promise.all(
        req.body.testResults.map((tr) =>
          prisma.runTest.update({
            where: { id: tr.runTestId },
            data: {
              status: tr.status as TestStatus,
              durationMs: tr.durationMs,
            },
          }).catch(() => {}), // ignore if runTest not found (defensive)
        ),
      );

      // Mark shard as complete
      await prisma.runShard.update({
        where: { id: shard.id },
        data: {
          status: req.body.status as RunStatus,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });

      // Aggregate run across all shards (fires notifications when complete)
      await aggregateRunShards(shard.runId);

      // Fire-and-forget: compute flake stats for each completed RunTest.
      // Fetch testCaseId + browser for the tests in this payload so we can
      // score them without blocking the response.
      const runTestIds = req.body.testResults.map((tr) => tr.runTestId);
      if (runTestIds.length > 0) {
        prisma.runTest.findMany({
          where: { id: { in: runTestIds } },
          select: { testCaseId: true, browser: true },
        }).then((rts) => {
          for (const rt of rts) {
            for (const windowDays of [7, 30] as const) {
              computeTestStats(rt.testCaseId, rt.browser as Browser, windowDays).catch((err: unknown) => {
                logger.error(
                  { err, testCaseId: rt.testCaseId, browser: rt.browser, windowDays },
                  'flakeScorer: computeTestStats failed (fire-and-forget)',
                );
              });
            }
          }
        }).catch((err: unknown) => {
          logger.error({ err }, 'flakeScorer: failed to load RunTests for scoring (fire-and-forget)');
        });
      }

      return reply.status(200).send({ ok: true });
    },
  );
}
