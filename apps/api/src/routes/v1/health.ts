import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — is the process alive?
  app.get('/healthz', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ok'), ts: z.string() }),
      },
    },
  }, async (_req, reply) => {
    return reply.send({ status: 'ok', ts: new Date().toISOString() });
  });

  // Readiness — can we serve traffic? (DB + Redis + S3)
  app.get('/readyz', {
    schema: {
      response: {
        200: z.object({
          status: z.literal('ok'),
          checks: z.record(z.string()),
        }),
        503: z.object({
          status: z.literal('degraded'),
          checks: z.record(z.string()),
        }),
      },
    },
  }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // DB check
    try {
      const { prisma } = await import('@sentinel/db');
      await prisma.$queryRaw`SELECT 1`;
      checks['db'] = 'ok';
    } catch (err) {
      checks['db'] = `error: ${err instanceof Error ? err.message : String(err)}`;
      healthy = false;
    }

    // Redis check
    try {
      // Named export, not default: ioredis is CJS, so under NodeNext the
      // default binding is the whole module namespace, not the class.
      const { Redis } = await import('ioredis');
      const { config } = await import('../../config.js');
      const redis = new Redis(config.REDIS_URL, { lazyConnect: true, connectTimeout: 3000 });
      await redis.ping();
      await redis.quit();
      checks['redis'] = 'ok';
    } catch (err) {
      checks['redis'] = `error: ${err instanceof Error ? err.message : String(err)}`;
      healthy = false;
    }

    const status = healthy ? 200 : 503;
    return reply.status(status).send({
      status: healthy ? 'ok' : 'degraded',
      checks,
    });
  });

  // Prometheus metrics placeholder (Phase 0: bare minimum)
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send([
      '# HELP sentinel_up Whether the API is up',
      '# TYPE sentinel_up gauge',
      'sentinel_up 1',
    ].join('\n'));
  });
}
