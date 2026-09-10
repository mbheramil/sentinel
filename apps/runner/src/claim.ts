import type { Job } from 'bullmq';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import { materializeWorkspace } from './workspace.js';
import { executeSandbox } from './sandbox/index.js';
import { collectAndUploadArtifacts } from './artifacts.js';
import type { JobPayload, ShardManifest } from './types.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

// ── Internal API helpers ─────────────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${config.API_INTERNAL_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': config.RUNNER_TOKEN,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return res.json();
  }
  return null;
}

// ── Main job processor ───────────────────────────────────────────────────────

export async function processJob(job: Job): Promise<void> {
  const payload = job.data as JobPayload;
  const { runId, shardId, shardIndex } = payload;

  const jobLog = logger.child({ jobId: job.id, runId, shardId, shardIndex });
  jobLog.info('Job received — claiming shard');

  // 1. Claim the shard from the API
  let manifest: ShardManifest;
  try {
    manifest = (await apiRequest(
      'POST',
      `/internal/shards/${shardId}/claim`,
      { runnerId: config.RUNNER_ID },
    )) as ShardManifest;
  } catch (err) {
    jobLog.error({ err }, 'Failed to claim shard — aborting job');
    throw err;
  }

  jobLog.info(
    {
      shardTotal: manifest.shardTotal,
      browsers: manifest.browsers,
      testCount: manifest.tests.length,
    },
    'Shard claimed',
  );

  // 2. Start heartbeat — use shardId from the manifest (authoritative DB id)
  const activeShardId = manifest.shardId;
  const heartbeat = setInterval(async () => {
    try {
      await apiRequest('POST', `/internal/shards/${activeShardId}/heartbeat`);
    } catch (err) {
      jobLog.warn({ err }, 'Heartbeat failed');
    }
  }, HEARTBEAT_INTERVAL_MS);

  // 3. Create an isolated temp workspace
  const workDir = mkdtempSync(join(tmpdir(), `sentinel-run-${runId}-`));
  jobLog.debug({ workDir }, 'Created workspace directory');

  let finalStatus: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'CANCELED' | 'ERROR' =
    'ERROR';

  try {
    // 4. Materialise workspace
    await materializeWorkspace(manifest, workDir);
    jobLog.debug('Workspace materialised');

    // 5. Execute sandbox
    const result = await executeSandbox(
      workDir,
      manifest,
      manifest.shardIndex,
      manifest.shardTotal,
    );

    jobLog.info(
      { exitCode: result.exitCode, timedOut: result.timedOut, canceled: result.canceled },
      'Sandbox finished',
    );

    if (result.canceled) {
      finalStatus = 'CANCELED';
    } else if (result.timedOut) {
      finalStatus = 'TIMED_OUT';
    } else {
      finalStatus = result.exitCode === 0 ? 'PASSED' : 'FAILED';
    }

    // 6. Collect & upload artifacts (best-effort; don't fail the shard on upload error)
    try {
      await collectAndUploadArtifacts(workDir, manifest);
    } catch (err) {
      jobLog.warn({ err }, 'Artifact collection/upload failed (non-fatal)');
    }
  } finally {
    // 7. Stop heartbeat
    clearInterval(heartbeat);

    // 8. Remove workspace
    try {
      rmSync(workDir, { recursive: true, force: true });
      jobLog.debug({ workDir }, 'Workspace removed');
    } catch (err) {
      jobLog.warn({ err, workDir }, 'Failed to remove workspace directory');
    }

    // 9. Mark shard as complete
    try {
      await apiRequest('PATCH', `/internal/shards/${activeShardId}/complete`, {
        status: finalStatus,
      });
      jobLog.info({ finalStatus }, 'Shard marked complete');
    } catch (err) {
      jobLog.error({ err }, 'Failed to mark shard complete');
    }
  }
}
