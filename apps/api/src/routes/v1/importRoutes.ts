/**
 * importRoutes.ts — Phase 6 Part D
 *
 * One-way git import: upserts TestCases from file content.
 * Mount at /api/v1 in server.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@sentinel/db';
import { ERROR_CODES } from '@sentinel/shared';
import { authPreHandler } from '../../auth/middleware.js';
import { resolveActor, getProjectOrgId } from '../../lib/actor.js';
import { authorize } from '../../auth/rbac.js';
import { logger } from '../../logger.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const FileEntrySchema = z.object({
  path: z.string().min(1).refine((p) => p.endsWith('.spec.ts'), {
    message: 'path must end in .spec.ts',
  }),
  content: z.string().min(1),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /projects/:id/import ────────────────────────────────────────────
  a.post(
    '/projects/:id/import',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          files: z.array(FileEntrySchema).min(1).max(500),
        }),
        response: {
          200: z.object({
            created: z.number(),
            updated: z.number(),
            errors: z.array(
              z.object({ path: z.string(), message: z.string() }),
            ),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const orgId = await getProjectOrgId(req.params.id);
      if (!orgId) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Project not found' },
        });
      }

      const actor = await resolveActor(req, reply, orgId);
      if (!actor) return;
      authorize(actor, 'tests:create');

      let created = 0;
      let updated = 0;
      const errors: Array<{ path: string; message: string }> = [];

      for (const file of req.body.files) {
        try {
          // Derive test name from file path (strip extension)
          const name = file.path
            .replace(/\\/g, '/')
            .replace(/\.spec\.ts$/, '');

          // Check if TestCase already exists for this project + filePath
          const existing = await prisma.testCase.findUnique({
            where: {
              projectId_filePath: {
                projectId: req.params.id,
                filePath: file.path,
              },
            },
            select: { id: true, currentVersionId: true },
          });

          if (existing) {
            // Determine next version number
            const latestVersion = await prisma.testVersion.findFirst({
              where: { testCaseId: existing.id },
              orderBy: { version: 'desc' },
              select: { version: true },
            });
            const nextVersion = (latestVersion?.version ?? 0) + 1;

            // Create a new TestVersion
            const newVersion = await prisma.testVersion.create({
              data: {
                testCaseId: existing.id,
                version: nextVersion,
                code: file.content,
                message: 'Imported via CLI push',
              },
              select: { id: true },
            });

            // Update TestCase code + currentVersionId
            await prisma.testCase.update({
              where: { id: existing.id },
              data: {
                code: file.content,
                currentVersionId: newVersion.id,
              },
            });

            updated++;
          } else {
            // Create new TestCase + initial TestVersion in a transaction
            await prisma.$transaction(async (tx) => {
              const tc = await tx.testCase.create({
                data: {
                  projectId: req.params.id,
                  name,
                  filePath: file.path,
                  code: file.content,
                  authoringMode: 'CODE',
                },
                select: { id: true },
              });

              const version = await tx.testVersion.create({
                data: {
                  testCaseId: tc.id,
                  version: 1,
                  code: file.content,
                  message: 'Initial import via CLI push',
                },
                select: { id: true },
              });

              await tx.testCase.update({
                where: { id: tc.id },
                data: { currentVersionId: version.id },
              });
            });

            created++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ path: file.path, message });
          logger.warn({ path: file.path, err }, 'importRoutes: failed to import file');
        }
      }

      logger.info(
        { projectId: req.params.id, created, updated, errors: errors.length },
        'importRoutes: import complete',
      );

      return reply.status(200).send({ created, updated, errors });
    },
  );
}
