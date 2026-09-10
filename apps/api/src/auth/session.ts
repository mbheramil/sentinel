import { compactDecrypt } from 'jose';
import { hkdfSync } from 'crypto';
import { prisma } from '@sentinel/db';
import { config } from '../config.js';
import type { FastifyRequest } from 'fastify';

export interface SessionIdentity {
  userId: string;
}

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

function deriveEncryptionKey(secret: string): Uint8Array {
  return hkdfSync('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32);
}

export async function verifySession(req: FastifyRequest): Promise<SessionIdentity | null> {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  let token: string | undefined;
  for (const name of SESSION_COOKIE_NAMES) {
    if (cookies[name]) { token = cookies[name]; break; }
  }
  if (!token) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      select: { userId: true, expires: true },
    });
    if (session) {
      if (session.expires <= new Date()) return null;
      return { userId: session.userId };
    }
  } catch { /* fall through */ }

  try {
    const encKey = deriveEncryptionKey(config.AUTH_SECRET);
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
  } catch { return null; }
}
