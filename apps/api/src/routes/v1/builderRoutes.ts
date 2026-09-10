import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { compile, StepIrSchema } from '@sentinel/ir';
import { authPreHandler } from '../../auth/middleware.js';

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const CompileWarningSchema = z.object({
  stepIndex: z.number(),
  message: z.string(),
  severity: z.enum(['warn', 'info']),
});

const CompileResultSchema = z.object({
  code: z.string(),
  warnings: z.array(CompileWarningSchema),
});

export async function builderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  const a = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /tests/compile-ir ──────────────────────────────────────────────────
  // Compiles a StepIr payload to Playwright TypeScript code (no persistence).
  a.post(
    '/tests/compile-ir',
    {
      schema: {
        body: z.object({ stepsIr: z.unknown() }),
        response: {
          200: CompileResultSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const parsed = StepIrSchema.safeParse(req.body.stepsIr);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_FAILED',
            message: `Invalid step IR: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          },
        });
      }

      const result = await compile(parsed.data);

      return reply.status(200).send(result);
    },
  );
}
