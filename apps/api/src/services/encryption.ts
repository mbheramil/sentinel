import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;

function getKey(): Buffer {
  const key = Buffer.from(config.SENTINEL_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `SENTINEL_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        'Generate with: openssl rand -base64 32',
    );
  }
  return key;
}

export interface EncryptedEnvelope {
  iv: string;         // base64
  authTag: string;    // base64
  ciphertext: string; // base64
  keyVersion: number;
}

export function encrypt(plaintext: string): EncryptedEnvelope {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function decrypt(envelope: EncryptedEnvelope): string {
  const key = getKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Serialize an EncryptedEnvelope to a Buffer suitable for Prisma Bytes fields. */
export function envelopeToBuffer(envelope: EncryptedEnvelope): Buffer {
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

/** Parse an EncryptedEnvelope from a Prisma Bytes field. */
export function bufferToEnvelope(buf: Buffer | Uint8Array): EncryptedEnvelope {
  return JSON.parse(Buffer.from(buf).toString('utf8')) as EncryptedEnvelope;
}
