import argon2 from 'argon2';
import { prisma } from '@sentinel/db';
import { API_KEY_PREFIX_LENGTH } from '@sentinel/shared';

export interface ApiKeyIdentity {
  apiKeyId: string;
  orgId: string;
  scopes: string[];
}

export async function verifyApiKey(rawKey: string): Promise<ApiKeyIdentity | null> {
  if (!rawKey.startsWith('sk_')) return null;

  const prefix = rawKey.slice(0, API_KEY_PREFIX_LENGTH);

  const apiKey = await prisma.apiKey.findUnique({
    where: { prefix },
    select: {
      id: true,
      orgId: true,
      scopes: true,
      hash: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!apiKey) return null;
  if (apiKey.revokedAt) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  // argon2.verify performs a constant-time comparison internally
  const valid = await argon2.verify(apiKey.hash, rawKey);
  if (!valid) return null;

  // Fire-and-forget lastUsedAt update — never delay the request for this
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { apiKeyId: apiKey.id, orgId: apiKey.orgId, scopes: apiKey.scopes };
}
