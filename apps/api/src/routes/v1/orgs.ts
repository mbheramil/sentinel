import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES, RoleSchema } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /orgs ──────────────────────────────────────────────────────────────
  a.get(
    '/orgs',
    {
      schema: {
        response: {
          200: z.array(
            z.object({ id: z.string(), name: z.string(), slug: z.string(), role: z.string() }),
          ),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!req.identity) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      if (req.identity.type === 'apiKey') {
        const org = await prisma.organization.findUnique({
          where: { id: req.identity.orgId! },
          select: { id: true, name: true, slug: true },
        });
        if (!org) return reply.status(200).send([]);
        return reply.status(200).send([{ ...org, role: 'ADMIN' }]);
      }

      const memberships = await prisma.membership.findMany({
        where: { userId: req.identity.userId! },
        select: {
          role: true,
          org: { select: { id: true, name: true, slug: true } },
        },
      });

      return reply.status(200).send(memberships.map((m) => ({ ...m.org, role: m.role })));
    },
  );

  // ── GET /orgs/:id/members ──────────────────────────────────────────────────
  a.get(
    '/orgs/:id/members',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.array(
            z.object({
              userId: z.string(),
              role: z.string(),
              user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }),
            }),
          ),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'members:list');

      const members = await prisma.membership.findMany({
        where: { orgId: req.params.id },
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.status(200).send(members);
    },
  );

  // ── POST /orgs/:id/invitations ─────────────────────────────────────────────
  a.post(
    '/orgs/:id/invitations',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ email: z.string().email(), role: RoleSchema }),
        response: {
          201: z.object({
            id: z.string(),
            email: z.string(),
            role: z.string(),
            expiresAt: z.string(),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'invitations:create');

      const { email, role } = req.body;
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invitation = await prisma.invitation.create({
        data: { orgId: req.params.id, email, role, token, expiresAt },
        select: { id: true, email: true, role: true, expiresAt: true },
      });

      return reply.status(201).send({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
      });
    },
  );

  // ── DELETE /orgs/:id/members/:userId ───────────────────────────────────────
  a.delete(
    '/orgs/:id/members/:userId',
    {
      schema: {
        params: z.object({ id: z.string(), userId: z.string() }),
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

      authorize(actor, 'members:remove');

      const membership = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: req.params.userId, orgId: req.params.id } },
        select: { id: true },
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Member not found' },
        });
      }

      await prisma.membership.delete({
        where: { userId_orgId: { userId: req.params.userId, orgId: req.params.id } },
      });

      return reply.status(200).send({ ok: true });
    },
  );

  // ── PATCH /orgs/:id/members/:userId ───────────────────────────────────────
  a.patch(
    '/orgs/:id/members/:userId',
    {
      schema: {
        params: z.object({ id: z.string(), userId: z.string() }),
        body: z.object({ role: RoleSchema }),
        response: {
          200: z.object({ userId: z.string(), role: z.string() }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const actor = await resolveActor(req, reply, req.params.id);
      if (!actor) return;

      authorize(actor, 'members:setRole');

      const existing = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: req.params.userId, orgId: req.params.id } },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Member not found' },
        });
      }

      const updated = await prisma.membership.update({
        where: { userId_orgId: { userId: req.params.userId, orgId: req.params.id } },
        data: { role: req.body.role },
        select: { userId: true, role: true },
      });

      return reply.status(200).send(updated);
    },
  );
}
