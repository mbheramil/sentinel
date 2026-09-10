import { readdirSync, statSync, createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { join, extname, basename } from 'path';
import archiver from 'archiver';
import { buildScrubber } from './events.js';
import { logger } from './logger.js';
import { config } from './config.js';
import type { ShardManifest } from './types.js';

// ── Artifact kinds understood by the API ─────────────────────────────────────

type ArtifactKind =
  | 'SCREENSHOT'
  | 'VIDEO'
  | 'TRACE'
  | 'HAR'
  | 'HTML_REPORT'
  | 'OTHER';

const EXT_KIND: Record<string, ArtifactKind> = {
  '.png': 'SCREENSHOT',
  '.webm': 'VIDEO',
  '.zip': 'TRACE',
  '.har': 'HAR',
};

// ── Walk a directory recursively ─────────────────────────────────────────────

function walk(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...walk(full));
        } else {
          results.push(full);
        }
      } catch {
        // Skip unreadable entries
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }
  return results;
}

// ── Zip the Playwright HTML report ───────────────────────────────────────────

async function zipReport(reportDir: string, destZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(reportDir, false);
    archive.finalize().catch(reject);
  });
}

// ── Presign + upload one artifact ────────────────────────────────────────────

async function uploadArtifact(
  filePath: string,
  kind: ArtifactKind,
  targetId: string,
  targetType: 'attempt' | 'run',
  runnerToken: string,
  scrub: (s: string) => string,
): Promise<void> {
  const artLog = logger.child({ filePath, kind, targetId, targetType });

  try {
    // 1. Presign
    const presignUrl =
      targetType === 'attempt'
        ? `${config.API_INTERNAL_URL}/internal/attempts/${targetId}/artifacts/presign`
        : `${config.API_INTERNAL_URL}/internal/runs/${targetId}/artifacts/presign`;

    const presignRes = await fetch(presignUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runnerToken}`,
      },
      body: JSON.stringify({
        kind,
        filename: basename(filePath),
        contentType: kind === 'SCREENSHOT' ? 'image/png' : 'application/octet-stream',
      }),
    });

    if (!presignRes.ok) {
      const text = await presignRes.text().catch(() => '(no body)');
      artLog.warn({ status: presignRes.status, text }, 'Presign request failed — skipping artifact');
      return;
    }

    const { uploadUrl, artifactId } = (await presignRes.json()) as {
      uploadUrl: string;
      artifactId: string;
    };

    artLog.debug({ artifactId }, 'Got presigned URL — uploading');

    // 2. Upload via presigned PUT.
    // Node.js 22 fetch accepts a web ReadableStream; convert from the fs stream.
    const stat = statSync(filePath);
    const fsStream = createReadStream(filePath);
    const webStream = Readable.toWeb(fsStream) as ReadableStream;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: webStream,
      headers: {
        'Content-Length': String(stat.size),
        'Content-Type': kind === 'SCREENSHOT' ? 'image/png' : 'application/octet-stream',
      },
      // Required by undici when body is a ReadableStream
      // @ts-expect-error — duplex is not in the TS lib types yet
      duplex: 'half',
    });

    if (!uploadRes.ok) {
      artLog.warn({ status: uploadRes.status }, 'Artifact upload PUT failed');
      return;
    }

    artLog.debug({ artifactId }, 'Artifact uploaded');
  } catch (err) {
    artLog.warn({ err }, 'Artifact upload threw unexpectedly');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function collectAndUploadArtifacts(
  workDir: string,
  manifest: ShardManifest,
  /**
   * Maps `${testId}:${attemptIndex}` → DB attemptId.
   * If a file can't be correlated to an attempt, it's skipped.
   */
  attemptMap: Map<string, string> = new Map(),
): Promise<void> {
  const runLog = logger.child({ runId: manifest.runId });
  const scrub = buildScrubber(manifest.environment.secrets);

  let totalBytes = 0;

  // Gather artifact files from test output directories
  const artifactDir = join(workDir, 'artifacts');
  const allFiles = walk(artifactDir);

  runLog.info({ fileCount: allFiles.length, artifactDir }, 'Collecting artifacts');

  for (const filePath of allFiles) {
    const ext = extname(filePath).toLowerCase();
    const kind: ArtifactKind = EXT_KIND[ext] ?? 'OTHER';

    if (kind === 'OTHER') continue; // Skip non-artifact files

    try {
      const size = statSync(filePath).size;
      if (totalBytes + size > config.ARTIFACT_MAX_BYTES) {
        runLog.warn(
          { filePath, totalBytes, limit: config.ARTIFACT_MAX_BYTES },
          'Artifact cap reached — skipping remaining files',
        );
        break;
      }
      totalBytes += size;
    } catch {
      continue;
    }

    // Attempt to correlate the artifact with a specific test attempt.
    // Playwright names output dirs as  <test-title>-<browser>-<retry-index>/
    // We do a best-effort match; unmatched artifacts are still uploaded but
    // associated with the run rather than a specific attempt.
    let matched = false;
    for (const [key, attemptId] of attemptMap) {
      if (filePath.includes(key.replace(/:/g, '-'))) {
        await uploadArtifact(
          filePath,
          kind,
          attemptId,
          'attempt',
          config.RUNNER_TOKEN,
          scrub,
        );
        matched = true;
        break;
      }
    }

    if (!matched) {
      runLog.debug({ filePath }, 'Could not correlate artifact to attempt — uploading against run');
      await uploadArtifact(
        filePath,
        kind,
        manifest.runId,
        'run',
        config.RUNNER_TOKEN,
        scrub,
      );
    }
  }

  // Upload Playwright HTML report as a single zip
  const reportDir = join(workDir, 'report');
  const reportZip = join(workDir, 'html-report.zip');

  try {
    await zipReport(reportDir, reportZip);
    const zipSize = statSync(reportZip).size;

    if (totalBytes + zipSize <= config.ARTIFACT_MAX_BYTES) {
      await uploadArtifact(
        reportZip,
        'HTML_REPORT',
        manifest.runId,
        'run',
        config.RUNNER_TOKEN,
        scrub,
      );
      runLog.info({ zipSize }, 'HTML report uploaded');
    } else {
      runLog.warn(
        { zipSize, totalBytes, limit: config.ARTIFACT_MAX_BYTES },
        'Skipping HTML report — artifact cap would be exceeded',
      );
    }
  } catch (err) {
    runLog.warn({ err }, 'HTML report zip/upload failed (non-fatal)');
  }

  runLog.info({ totalBytes, fileCount: allFiles.length }, 'Artifact collection complete');
}
