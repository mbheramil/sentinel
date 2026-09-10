/**
 * adminRoutes.ts — Phase 6 Part B
 *
 * OWNER-only admin dashboard API.
 * Mount at /api/v1 in server.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor } from '../../lib/actor.js';
import { hasMinRole } from '../../auth/rbac.js';
import { getQueue } from '../../queue/producer.js';
import { getRedis } from '../../lib/redis.js';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** Get the schedule queue (mirrors what scheduleSync.ts creates). */
function getScheduleQueue(): Queue {
  const connection = getRedis() as Redis;
  return new Queue('sentinel-schedules', { connection });
}

/** Safely get BullMQ job counts, returning zeros on failure. */
async function safeGetCounts(
  queue: Queue,
): Promise<{ waiting: number; active: number; delayed: number }> {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
    return {
      waiting: counts['waiting'] ?? 0,
      active: counts['active'] ?? 0,
      delayed: counts['delayed'] ?? 0,
    };
  } catch {
    return { waiting: 0, active: 0, delayed: 0 };
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /admin/overview ──────────────────────────────────────────────────
  a.get(
    '/admin/overview',
    {
      schema: {
        response: {
          200: z.object({
            runners: z.array(
              z.object({
                runnerId: z.string(),
                slots: z.object({ used: z.number(), max: z.number() }),
                queueDepth: z.number(),
                lastSeenAt: z.string().nullable(),
              }),
            ),
            queues: z.object({
              runs: z.object({ waiting: z.number(), active: z.number(), delayed: z.number() }),
              schedules: z.object({ waiting: z.number(), active: z.number(), delayed: z.number() }),
            }),
            stuckRuns: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                startedAt: z.string().nullable(),
                project: z.object({ id: z.string(), name: z.string() }),
              }),
            ),
            dbStats: z.object({
              totalRuns: z.number(),
              totalTests: z.number(),
              artifactGb: z.number(),
            }),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      // Resolve actor — we need any org context; we use the first org the user
      // belongs to that has OWNER role.
      const identity = req.identity;
      if (!identity) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      // Find an org where this user is OWNER
      let ownerOrgId: string | null = null;
      if (identity.type === 'session' && identity.userId) {
        const membership = await prisma.membership.findFirst({
          where: { userId: identity.userId, role: 'OWNER' },
          select: { orgId: true },
        });
        ownerOrgId = membership?.orgId ?? null;
      }

      if (!ownerOrgId) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: 'OWNER role required' },
        });
      }

      const actor = await resolveActor(req, reply, ownerOrgId);
      if (!actor) return;

      if (!hasMinRole(actor, 'OWNER')) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: 'OWNER role required' },
        });
      }

      // ── Runner health: aggregate live RunShards ──────────────────────────
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const activeShards = await prisma.runShard.findMany({
        where: {
          status: 'RUNNING',
          runnerId: { not: null },
        },
        select: {
          runnerId: true,
          heartbeatAt: true,
        },
      });

      // Group by runnerId
      const runnerMap = new Map<
        string,
        { used: number; lastSeenAt: Date | null }
      >();

      for (const shard of activeShards) {
        if (!shard.runnerId) continue;
        const existing = runnerMap.get(shard.runnerId);
        const latest =
          existing?.lastSeenAt && shard.heartbeatAt
            ? shard.heartbeatAt > existing.lastSeenAt
              ? shard.heartbeatAt
              : existing.lastSeenAt
            : shard.heartbeatAt ?? existing?.lastSeenAt ?? null;

        runnerMap.set(shard.runnerId, {
          used: (existing?.used ?? 0) + 1,
          lastSeenAt: latest,
        });
      }

      const runners = Array.from(runnerMap.entries()).map(([runnerId, info]) => ({
        runnerId,
        slots: { used: info.used, max: 2 }, // default max from config
        queueDepth: 0,
        lastSeenAt: info.lastSeenAt?.toISOString() ?? null,
      }));

      // ── Queue depths ─────────────────────────────────────────────────────
      const runsQueue = getQueue();
      const schedulesQueue = getScheduleQueue();

      const [runsCounts, schedulesCounts] = await Promise.all([
        safeGetCounts(runsQueue),
        safeGetCounts(schedulesQueue),
      ]);

      // Update runner queueDepth from runs queue active count
      for (const runner of runners) {
        runner.queueDepth = runsCounts.active;
      }

      // ── Stuck runs: RUNNING > 2h ─────────────────────────────────────────
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const stuckRuns = await prisma.run.findMany({
        where: {
          status: 'RUNNING',
          startedAt: { lt: twoHoursAgo },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: 'asc' },
        take: 50,
      });

      // ── DB stats ─────────────────────────────────────────────────────────
      const [totalRuns, totalTests, artifactAgg] = await Promise.all([
        prisma.run.count(),
        prisma.testCase.count(),
        prisma.artifact.aggregate({ _sum: { sizeBytes: true } }),
      ]);

      const artifactBytes = artifactAgg._sum.sizeBytes ?? 0;
      const artifactGb = Math.round((artifactBytes / 1_073_741_824) * 100) / 100;

      return reply.status(200).send({
        runners,
        queues: {
          runs: {
            waiting: runsCounts.waiting,
            active: runsCounts.active,
            delayed: runsCounts.delayed,
          },
          schedules: {
            waiting: schedulesCounts.waiting,
            active: schedulesCounts.active,
            delayed: schedulesCounts.delayed,
          },
        },
        stuckRuns: stuckRuns.map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt?.toISOString() ?? null,
          project: r.project,
        })),
        dbStats: { totalRuns, totalTests, artifactGb },
      });
    },
  );

  // ── POST /admin/runs/:id/force-fail ──────────────────────────────────────
  a.post(
    '/admin/runs/:id/force-fail',
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
      const identity = req.identity;
      if (!identity) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      // Verify OWNER role
      let ownerOrgId: string | null = null;
      if (identity.type === 'session' && identity.userId) {
        const membership = await prisma.membership.findFirst({
          where: { userId: identity.userId, role: 'OWNER' },
          select: { orgId: true },
        });
        ownerOrgId = membership?.orgId ?? null;
      }

      if (!ownerOrgId) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: 'OWNER role required' },
        });
      }

      const actor = await resolveActor(req, reply, ownerOrgId);
      if (!actor) return;

      if (!hasMinRole(actor, 'OWNER')) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: 'OWNER role required' },
        });
      }

      // Find the run
      const run = await prisma.run.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true },
      });

      if (!run) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' },
        });
      }

      const now = new Date();

      // Force all QUEUED/RUNNING shards to ERROR
      await prisma.runShard.updateMany({
        where: { runId: req.params.id, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'ERROR', finishedAt: now },
      });

      // Force the run to ERROR
      await prisma.run.update({
        where: { id: req.params.id },
        data: {
          status: 'ERROR',
          finishedAt: now,
          errorMessage: 'Force-failed by admin',
        },
      });

      app.log.warn({ runId: req.params.id }, 'Run force-failed by admin');

      return reply.status(200).send({ ok: true });
    },
  );
}
