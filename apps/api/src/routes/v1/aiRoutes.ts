import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getAttemptOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { getRedis } from '../../lib/redis.js';
import {
  generateTest,
  triageFailure,
  computeErrorSignature,
  recordAiUsage,
} from '../../services/ai.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ── Per-org rate limiter (10 generate calls / hour) ───────────────────────────

const RATE_LIMIT_WINDOW_SEC = 3600;
const RATE_LIMIT_MAX = 10;

async function checkGenerateRateLimit(orgId: string): Promise<void> {
  const redis = getRedis();
  const key = `sentinel:ai:gen:${orgId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    // First call in this window — set expiry
    await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  if (count > RATE_LIMIT_MAX) {
    throw Object.assign(
      new Error(`Rate limit exceeded: ${RATE_LIMIT_MAX} AI generations per hour per organisation`),
      { statusCode: 429, code: 'RATE_LIMITED' },
    );
  }
}

// ── Response shapes ───────────────────────────────────────────────────────────

const GenerateResponseSchema = z.object({
  stepsIr: z.unknown(),
  code: z.string(),
  explanation: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

const TriageResponseSchema = z.object({
  likelyCause: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  suggestion: z.string(),
  fromCache: z.boolean(),
  disclaimer: z.string(),
});

const AiUsageWeekSchema = z.object({
  week: z.string(),
  totalCostUsdMicro: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  callCount: z.number(),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /tests/generate ───────────────────────────────────────────────────
  a.post(
    '/tests/generate',
    {
      schema: {
        body: z.object({
          prompt: z.string().min(1).max(4000),
          url: z.string().url().optional(),
          deepMode: z.boolean().optional(),
        }),
        response: {
          200: GenerateResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          402: ErrorSchema,
          403: ErrorSchema,
          429: ErrorSchema,
          502: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      // Require authentication; actor must belong to some org.
      if (!req.identity) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      // For session-based users, derive orgId from their first membership.
      // API key actors carry orgId directly on their identity.
      let orgId: string | undefined;
      if (req.identity.type === 'apiKey') {
        orgId = req.identity.orgId;
      } else {
        const membership = await prisma.membership.findFirst({
          where: { userId: req.identity.userId },
          select: { orgId: true, role: true },
        });
        orgId = membership?.orgId;
      }

      if (!orgId) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: 'No organisation membership found' },
        });
      }

      // Resolve actor for RBAC check
      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      authorize(actor, 'tests:create');

      // Rate limit + generation — both wrapped so thrown errors get the right shape
      let result;
      try {
        await checkGenerateRateLimit(orgId);
        result = await generateTest({
          prompt: req.body.prompt,
          url: req.body.url,
          orgId,
          deepMode: req.body.deepMode ?? false,
        });
      } catch (err) {
        const e = err as Error & { statusCode?: number; code?: string };
        const status = ([400, 402, 429, 502] as number[]).includes(e.statusCode ?? 0)
          ? (e.statusCode as 400 | 402 | 429 | 502)
          : 502;
        return reply.status(status).send({
          error: { code: e.code ?? 'AI_ERROR', message: e.message ?? 'AI generation failed' },
        });
      }

      await recordAiUsage({
        orgId,
        operation: 'generate',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      return reply.status(200).send({
        stepsIr: result.stepsIr,
        code: result.code,
        explanation: result.explanation,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    },
  );

  // ── POST /attempts/:id/triage ──────────────────────────────────────────────
  a.post(
    '/attempts/:id/triage',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({}).optional(),
        response: {
          200: TriageResponseSchema,
          // 400: attempt is not in a triageable state.
          400: ErrorSchema,
          401: ErrorSchema,
          402: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          502: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const attemptId = req.params.id;

      const orgId = await getAttemptOrgId(attemptId);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;

      // Load attempt data needed for triage
      const attempt = await prisma.attempt.findUnique({
        where: { id: attemptId },
        select: {
          status: true,
          errorName: true,
          errorMessage: true,
          runTest: { select: { testVersionId: true } },
        },
      });

      if (!attempt) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' },
        });
      }

      if (attempt.status !== 'FAILED' && attempt.status !== 'TIMED_OUT') {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Triage is only available for FAILED or TIMED_OUT attempts' },
        });
      }

      const testVersionId = attempt.runTest?.testVersionId ?? null;
      if (!testVersionId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Test version not found for this attempt' },
        });
      }

      const errorSignature = computeErrorSignature(attempt.errorName, attempt.errorMessage);

      const result = await triageFailure({
        testVersionId,
        attemptId,
        errorSignature,
        orgId,
      });

      // Usage tracking is handled inside triageFailure for non-cache results.

      return reply.status(200).send({
        likelyCause: result.likelyCause,
        confidence: result.confidence,
        suggestion: result.suggestion,
        fromCache: result.fromCache,
        disclaimer: 'This is an AI suggestion — verify before acting.',
      });
    },
  );

  // ── GET /orgs/:id/ai-usage ─────────────────────────────────────────────────
  a.get(
    '/orgs/:id/ai-usage',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ weeks: z.array(AiUsageWeekSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      // Group by ISO week using raw query for efficiency
      const rows = await prisma.aiUsage.findMany({
        where: { orgId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      // Group into weeks in application code (portable across DB engines)
      const weekMap = new Map<
        string,
        { totalCostUsdMicro: number; inputTokens: number; outputTokens: number; callCount: number }
      >();

      for (const row of rows) {
        const d = row.createdAt;
        // ISO week: YYYY-Www
        const jan4 = new Date(d.getFullYear(), 0, 4);
        const dayOfYear = Math.floor(
          (d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000,
        );
        const weekNum = Math.ceil((dayOfYear + jan4.getDay()) / 7);
        const week = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

        const existing = weekMap.get(week) ?? {
          totalCostUsdMicro: 0,
          inputTokens: 0,
          outputTokens: 0,
          callCount: 0,
        };
        weekMap.set(week, {
          totalCostUsdMicro: existing.totalCostUsdMicro + row.costUsdMicro,
          inputTokens: existing.inputTokens + row.inputTokens,
          outputTokens: existing.outputTokens + row.outputTokens,
          callCount: existing.callCount + 1,
        });
      }

      const weeks = Array.from(weekMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([week, data]) => ({ week, ...data }));

      return reply.status(200).send({ weeks });
    },
  );
}
