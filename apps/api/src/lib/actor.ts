import { prisma } from '@sentinel/db';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@sentinel/shared';
import { ERROR_CODES } from '@sentinel/shared';
import type { Actor } from '../auth/rbac.js';

/**
 * Resolve a fully-populated Actor for the given org context.
 * Sends a 401 or 403 reply and returns null when resolution fails.
 * The caller must check `if (!actor) return;` to short-circuit the handler.
 */
export async function resolveActor(
  req: FastifyRequest,
  reply: FastifyReply,
  orgId: string,
): Promise<Actor | null> {
  const identity = req.identity;

  if (!identity) {
    await reply.status(401).send({
      error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
    });
    return null;
  }

  if (identity.type === 'apiKey') {
    if (identity.orgId !== orgId) {
      await reply.status(403).send({
        error: { code: ERROR_CODES.FORBIDDEN, message: 'API key is not authorised for this organisation' },
      });
      return null;
    }
    // API keys inherit ADMIN privileges within their org scope; scopes constrain operations further.
    return {
      userId: null,
      orgId,
      role: 'ADMIN' as Role,
      scopes: identity.scopes,
      apiKeyId: identity.apiKeyId,
    };
  }

  // Session-based — look up org membership
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: identity.userId!, orgId } },
    select: { role: true },
  });

  if (!membership) {
    await reply.status(403).send({
      error: { code: ERROR_CODES.FORBIDDEN, message: 'Not a member of this organisation' },
    });
    return null;
  }

  return {
    userId: identity.userId!,
    orgId,
    role: membership.role as Role,
  };
}

/** Look up the orgId that owns a project. Returns null when project not found. */
export async function getProjectOrgId(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  return project?.orgId ?? null;
}

/** Look up the orgId that owns a test case (via project). Returns null when not found. */
export async function getTestCaseOrgId(testCaseId: string): Promise<string | null> {
  const tc = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { project: { select: { orgId: true } } },
  });
  return tc?.project.orgId ?? null;
}

/** Look up the orgId that owns a run (via project). Returns null when not found. */
export async function getRunOrgId(runId: string): Promise<string | null> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { project: { select: { orgId: true } } },
  });
  return run?.project.orgId ?? null;
}

/** Look up the orgId that owns an attempt (via runTest → run → project). Returns null when not found. */
export async function getAttemptOrgId(attemptId: string): Promise<string | null> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      runTest: {
        select: {
          run: { select: { project: { select: { orgId: true } } } },
          testVersionId: true,
        },
      },
    },
  });
  return attempt?.runTest.run.project.orgId ?? null;
}

/** Look up the testVersionId for an attempt. Returns null when not found. */
export async function getAttemptTestVersionId(attemptId: string): Promise<string | null> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { runTest: { select: { testVersionId: true } } },
  });
  return attempt?.runTest.testVersionId ?? null;
}
