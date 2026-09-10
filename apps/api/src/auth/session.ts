import { compactDecrypt, hkdf } from 'jose';
import { prisma } from '@sentinel/db';
import { config } from '../config.js';
import type { FastifyRequest } from 'fastify';

export interface SessionIdentity {
  userId: string;
}

// Cookie names that Auth.js / NextAuth may set
const SESSION_COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
];

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

/** Derive the Auth.js JWE encryption key from AUTH_SECRET (matches @auth/core behaviour). */
async function deriveEncryptionKey(secret: string): Promise<Uint8Array> {
  return hkdf('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32);
}

export async function verifySession(req: FastifyRequest): Promise<SessionIdentity | null> {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  let token: string | undefined;
  for (const name of SESSION_COOKIE_NAMES) {
    if (cookies[name]) {
      token = cookies[name];
      break;
    }
  }
  if (!token) return null;

  // Strategy 1: database session (Auth.js database adapter stores opaque tokens)
  try {
    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      select: { userId: true, expires: true },
    });
    if (session) {
      if (session.expires <= new Date()) return null; // expired
      return { userId: session.userId };
    }
  } catch {
    // DB unavailable — fall through to JWT strategy
  }

  // Strategy 2: JWT session (Auth.js JWT adapter — token is a JWE compact serialisation)
  try {
    const encKey = await deriveEncryptionKey(config.AUTH_SECRET);
    const { plaintext } = await compactDecrypt(token, encKey, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256CBC-HS512', 'A256GCM'],
    });
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;

    const exp = payload['exp'];
    if (typeof exp === 'number' && Date.now() / 1000 > exp) return null;

    const userId = payload['sub'] ?? payload['id'] ?? payload['userId'];
    if (typeof userId !== 'string' || !userId) return null;

    return { userId };
  } catch {
    return null;
  }
}
