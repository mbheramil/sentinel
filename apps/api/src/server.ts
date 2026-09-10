import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { logger } from './logger.js';
import { ERROR_CODES } from '@sentinel/shared';
import { healthRoutes } from './routes/v1/health.js';
import { authRoutes } from './routes/v1/auth.js';
import { orgRoutes } from './routes/v1/orgs.js';
import { apiKeyRoutes } from './routes/v1/apiKeys.js';
import { projectRoutes } from './routes/v1/projects.js';
import { environmentRoutes } from './routes/v1/environments.js';
import { testRoutes } from './routes/v1/tests.js';
import { runRoutes } from './routes/v1/runs.js';
import { phase2Routes } from './routes/v1/phase2.js';
import { phase3Routes, hookRoutes } from './routes/v1/phase3.js';
import { aiRoutes } from './routes/v1/aiRoutes.js';
import { adminRoutes } from './routes/v1/adminRoutes.js';
import { baselineRoutes } from './routes/v1/baselineRoutes.js';
import { importRoutes } from './routes/v1/importRoutes.js';
import { builderRoutes } from './routes/v1/builderRoutes.js';
import { internalRoutes } from './routes/internal/index.js';
import { startReaper } from './queue/reaper.js';
import { startRetentionReaper, startStatsReconciler } from './queue/reaper2.js';

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
  });

  // Type provider
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  // Rate limiting. `global: false` so only routes that declare
  // `config.rateLimit` are limited — currently the public capture webhook,
  // which is unauthenticated and therefore the one route that needs it.
  await app.register(fastifyRateLimit, { global: false });

  // CORS
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Sentinel API',
        description: 'Self-hosted Playwright testing platform',
        version: '1.0.0',
      },
      servers: [{ url: config.SENTINEL_PUBLIC_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sentinel-session' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: false },
  });

  // ── Route registration ──────────────────────────────────────────────────
  // Health + metrics at root (no prefix)
  await app.register(healthRoutes);

  // Public capture webhook at root (Phase 3) — before auth middleware
  await app.register(hookRoutes);

  // Public v1 routes
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(orgRoutes, { prefix: '/api/v1' });
  await app.register(apiKeyRoutes, { prefix: '/api/v1' });
  await app.register(projectRoutes, { prefix: '/api/v1' });
  await app.register(environmentRoutes, { prefix: '/api/v1' });
  await app.register(testRoutes, { prefix: '/api/v1' });
  await app.register(runRoutes, { prefix: '/api/v1' });
  await app.register(phase2Routes, { prefix: '/api/v1' });
  await app.register(phase3Routes, { prefix: '/api/v1' });
  await app.register(aiRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(baselineRoutes, { prefix: '/api/v1' });
  await app.register(importRoutes, { prefix: '/api/v1' });
  await app.register(builderRoutes, { prefix: '/api/v1' });

  // Internal routes (runner-authenticated)
  await app.register(internalRoutes, { prefix: '/internal' });

  // ── Global error handler ────────────────────────────────────────────────
  // Explicit FastifyError annotation: with the Zod type provider installed the
  // handler's `error` parameter otherwise widens to `unknown`.
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error({ err: error }, 'Unhandled error');
    }

    // Prefer an explicit code on the error, then derive from status
    const code =
      (error as unknown as Record<string, unknown>)['code'] as string | undefined ??
      (statusCode >= 500 ? ERROR_CODES.INTERNAL
        : statusCode === 401 ? ERROR_CODES.UNAUTHENTICATED
        : statusCode === 403 ? ERROR_CODES.FORBIDDEN
        : statusCode === 404 ? ERROR_CODES.NOT_FOUND
        : statusCode === 409 ? ERROR_CODES.CONFLICT
        : ERROR_CODES.VALIDATION_FAILED);

    return reply.status(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? 'Internal server error' : error.message,
        details: error.validation ?? undefined,
      },
    });
  });

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
    app.log.info(`Sentinel API listening on port ${config.API_PORT}`);
    app.log.info(`OpenAPI docs at http://localhost:${config.API_PORT}/docs`);

    // Start the orphan-shard reaper
    startReaper();
    // Start Phase 2 + Phase 3 background jobs
    await startRetentionReaper();
    await startStatsReconciler();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
