import { prisma } from '@sentinel/db';
import { deleteObject } from './artifacts.js';
import { logger } from '../logger.js';

/**
 * Run a single retention-reaper cycle.
 *
 * Steps:
 *  1. Find all Artifact rows where expiresAt < now
 *  2. For each: deleteObject(storageKey) — tolerates S3 404, logs divergence
 *  3. Delete the Artifact DB row
 *  4. Return counts; never silently swallow errors
 */
export async function runReaper(): Promise<{ deleted: number; errors: number }> {
  const now = new Date();
  let deleted = 0;
  let errors = 0;

  const expired = await prisma.artifact.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, storageKey: true },
  });

  logger.info({ count: expired.length }, 'RetentionReaper: found expired artifacts');

  for (const artifact of expired) {
    // ── 1. Delete from S3 ─────────────────────────────────────────────────
    try {
      await deleteObject(artifact.storageKey);
    } catch (err: unknown) {
      const isNotFound =
        err != null &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'NoSuchKey';

      if (isNotFound) {
        // S3 object already gone — log divergence and continue to remove the DB row
        logger.warn(
          { artifactId: artifact.id, storageKey: artifact.storageKey },
          'RetentionReaper: S3 object not found (divergence) — proceeding with DB delete',
        );
      } else {
        logger.warn(
          { err, artifactId: artifact.id, storageKey: artifact.storageKey },
          'RetentionReaper: S3 delete failed — skipping DB delete',
        );
        errors++;
        continue; // don't delete DB row if S3 delete failed for an unknown reason
      }
    }

    // ── 2. Delete the DB row ──────────────────────────────────────────────
    try {
      await prisma.artifact.delete({ where: { id: artifact.id } });
      deleted++;
    } catch (err) {
      logger.error(
        { err, artifactId: artifact.id },
        'RetentionReaper: DB artifact delete failed',
      );
      errors++;
    }
  }

  logger.info({ deleted, errors }, 'RetentionReaper: cycle complete');
  return { deleted, errors };
}
