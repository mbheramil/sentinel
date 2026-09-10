import type { FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@sentinel/shared';
import { verifySession } from './session.js';
import { verifyApiKey } from './apiKey.js';

export interface AuthenticatedIdentity {
  type: 'session' | 'apiKey';
  userId?: string;
  apiKeyId?: string;
  orgId?: string;
  scopes?: string[];
}

// Extend Fastify's request type globally
declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthenticatedIdentity;
  }
}

/**
 * Fastify preHandler that resolves req.identity from either:
 *  - An Authorization: Bearer sk_... API key header
 *  - An authjs.session-token session cookie
 *
 * Does NOT enforce authentication — routes must check req.identity themselves.
 * If an Authorization header is present but the key is invalid, replies 401 immediately.
 */
export async function authPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Authorization header must use Bearer scheme' },
      });
    }
    const rawKey = authHeader.slice(7).trim();
    const identity = await verifyApiKey(rawKey);
    if (!identity) {
      return reply.status(401).send({
        error: { code: ERROR_CODES.UNAUTHENTICATED, message: 'Invalid or revoked API key' },
      });
    }
    req.identity = {
      type: 'apiKey',
      apiKeyId: identity.apiKeyId,
      orgId: identity.orgId,
      scopes: identity.scopes,
    };
    return;
  }

  const sessionIdentity = await verifySession(req);
  if (sessionIdentity) {
    req.identity = { type: 'session', userId: sessionIdentity.userId };
  }
  // No credentials present — identity stays undefined; unauthenticated routes proceed normally.
}
