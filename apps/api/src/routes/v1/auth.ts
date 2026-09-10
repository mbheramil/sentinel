import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import argon2 from 'argon2';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';

const SignupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
  orgName: z.string().min(1).max(255),
  orgSlug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens',
  }),
});

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  memberships: z.array(
    z.object({
      orgId: z.string(),
      role: z.string(),
      org: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    }),
  ),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /auth/signup ──────────────────────────────────────────────────────
  a.post(
    '/auth/signup',
    {
      schema: {
        body: SignupBodySchema,
        response: {
          201: z.object({ userId: z.string(), orgId: z.string() }),
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { email, password, name, orgName, orgSlug } = req.body;

      const [existingUser, existingOrg] = await Promise.all([
        prisma.user.findUnique({ where: { email }, select: { id: true } }),
        prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } }),
      ]);

      if (existingUser) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'Email already registered' },
        });
      }
      if (existingOrg) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'Organisation slug already taken' },
        });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, name, passwordHash } });
        const org = await tx.organization.create({ data: { name: orgName, slug: orgSlug } });
        await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: 'OWNER' } });
        return { userId: user.id, orgId: org.id };
      });

      return reply.status(201).send(result);
    },
  );

  // ── POST /auth/login ───────────────────────────────────────────────────────
  a.post(
    '/auth/login',
    {
      schema: {
        body: LoginBodySchema,
        response: {
          200: z.object({ userId: z.string(), email: z.string() }),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      });

      const validCredentials =
        user?.passwordHash && (await argon2.verify(user.passwordHash, password));

      if (!user || !validCredentials) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Invalid credentials' },
        });
      }

      // Create a database session
      const sessionToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

      const isProduction = process.env['NODE_ENV'] === 'production';
      const cookieName = isProduction
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token';
      const secure = isProduction ? '; Secure' : '';

      reply.header(
        'Set-Cookie',
        `${cookieName}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${30 * 24 * 3600}`,
      );

      return reply.status(200).send({ userId: user.id, email: user.email });
    },
  );

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  a.post(
    '/auth/logout',
    {
      schema: {
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const cookieHeader = req.headers['cookie'] ?? '';
      const cookies: Record<string, string> = {};
      for (const pair of cookieHeader.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }

      const token =
        cookies['__Secure-authjs.session-token'] ??
        cookies['authjs.session-token'] ??
        cookies['__Secure-next-auth.session-token'] ??
        cookies['next-auth.session-token'];

      if (token) {
        await prisma.session.deleteMany({ where: { sessionToken: token } }).catch(() => {});
      }

      reply.header(
        'Set-Cookie',
        'authjs.session-token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      );
      reply.header(
        'Set-Cookie',
        '__Secure-authjs.session-token=; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=0',
      );

      return reply.status(200).send({ ok: true });
    },
  );

  // ── GET /me ────────────────────────────────────────────────────────────────
  a.get(
    '/me',
    {
      preHandler: authPreHandler,
      schema: {
        response: { 200: MeSchema, 401: ErrorSchema },
      },
    },
    async (req, reply) => {
      if (!req.identity?.userId) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required' },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.identity.userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          memberships: {
            select: {
              orgId: true,
              role: true,
              org: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      if (!user) {
        return reply.status(401).send({
          error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'User session is invalid' },
        });
      }

      return reply.status(200).send(user);
    },
  );
}
