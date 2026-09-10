import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import type { ArtifactKind } from '@sentinel/db';

const DEFAULT_GET_EXPIRES_SECONDS = 600;   // 10 minutes
const DEFAULT_PUT_EXPIRES_SECONDS = 1800;  // 30 minutes

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

/**
 * Generate a short-lived presigned GET URL for an existing S3 object.
 * Default expiry: 10 minutes (600 s).
 */
export async function presignGet(
  storageKey: string,
  expiresInSeconds: number = DEFAULT_GET_EXPIRES_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(getS3(), command, { expiresIn: expiresInSeconds });
}

/**
 * Generate a presigned PUT URL so a runner can upload directly to S3.
 * Expiry: 30 minutes (1800 s).
 */
export async function presignPut(storageKey: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: storageKey,
    ContentType: contentType,
  });
  return getSignedUrl(getS3(), command, { expiresIn: DEFAULT_PUT_EXPIRES_SECONDS });
}

/**
 * Delete an object from S3. Callers should tolerate the resulting error if the
 * object is already gone (NoSuchKey); that decision belongs to the caller.
 */
export async function deleteObject(storageKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: storageKey,
  });
  await getS3().send(command);
}

/**
 * Build a canonical S3 storage key for an artifact.
 *
 * Layout:
 *   runs/<runId>/attempts/<attemptId>/<kind>/<filename?>
 *   runs/<runId>/<kind>/<filename?>
 */
export function buildStorageKey(
  kind: ArtifactKind,
  runId: string,
  attemptId?: string,
  filename?: string,
): string {
  const parts: string[] = ['runs', runId];
  if (attemptId) {
    parts.push('attempts', attemptId);
  }
  parts.push(kind.toLowerCase());
  if (filename) {
    parts.push(filename);
  }
  return parts.join('/');
}
