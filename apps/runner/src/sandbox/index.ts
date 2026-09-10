import { spawn } from 'child_process';
import type { Logger } from 'pino';
import { Redis } from 'ioredis';
import type { ChildProcess } from 'child_process';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { parseAndForwardEvents } from '../events.js';
import { PLAYWRIGHT_VERSION } from '@sentinel/shared';
import type { ShardManifest, SandboxResult } from '../types.js';

const SIGKILL_GRACE_MS = 10_000;

// ── Cancel-signal subscription ───────────────────────────────────────────────

async function watchCancel(
  runId: string,
  onCancel: () => void,
): Promise<{ unsubscribe: () => Promise<void> }> {
  const sub = new Redis(config.REDIS_URL);
  const channel = `run:${runId}:control`;

  await sub.subscribe(channel);

  sub.on('message', (ch: string, msg: string) => {
    if (ch === channel && msg === 'CANCELED') {
      onCancel();
    }
  });

  return {
    unsubscribe: async () => {
      await sub.unsubscribe(channel);
      sub.disconnect();
    },
  };
}

// ── Kill helpers ─────────────────────────────────────────────────────────────

function killProcess(proc: ChildProcess, runLog: Logger): void {
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Already exited
      }
    }, SIGKILL_GRACE_MS).unref();
  } catch {
    runLog.warn('Could not send signal to child process');
  }
}

function killContainer(
  containerId: string,
  runLog: Logger,
): void {
  const stop = spawn('docker', ['stop', '--time', '10', containerId], {
    stdio: 'ignore',
  });
  stop.on('error', (err) => runLog.warn({ err }, 'docker stop failed'));
}

// ── Local strategy ────────────────────────────────────────────────────────────

async function runLocal(
  workDir: string,
  manifest: ShardManifest,
  shardIndex: number,
  shardTotal: number,
): Promise<SandboxResult> {
  if (config.NODE_ENV === 'production') {
    throw new Error(
      'SANDBOX_STRATEGY=local is not permitted in production (NODE_ENV=production). ' +
        'Use the docker strategy instead.',
    );
  }

  const runLog = logger.child({ runId: manifest.runId, shardIndex, strategy: 'local' });

  const shardArg = `--shard=${shardIndex + 1}/${shardTotal}`;
  const playwrightCmd = ['npx', `@playwright/test@${PLAYWRIGHT_VERSION}`, 'test', shardArg];

  runLog.info({ cmd: playwrightCmd.join(' '), workDir }, 'Spawning local playwright process');

  const proc = spawn(playwrightCmd[0]!, playwrightCmd.slice(1), {
    cwd: workDir,
    env: {
      ...process.env,
      SENTINEL_RUN_ID: manifest.runId,
      SENTINEL_SHARD_INDEX: String(shardIndex),
      SENTINEL_PW_VERSION: PLAYWRIGHT_VERSION,
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let timedOut = false;
  let canceled = false;

  // Hard wall-clock cap
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    runLog.warn(
      { limitMs: config.RUN_MAX_DURATION_MS },
      'Run exceeded wall-clock limit — killing process',
    );
    killProcess(proc, runLog);
  }, config.RUN_MAX_DURATION_MS);
  timeoutHandle.unref();

  // Cancel subscription
  const canceler = await watchCancel(manifest.runId, () => {
    canceled = true;
    runLog.info('Cancellation signal received — killing process');
    killProcess(proc, runLog);
  });

  // Forward events from stdout
  if (proc.stdout) {
    parseAndForwardEvents(
      proc.stdout,
      manifest.runId,
      shardIndex,
      config.API_INTERNAL_URL,
      config.RUNNER_TOKEN,
      manifest.environment.secrets,
    ).catch((err) => runLog.warn({ err }, 'Event forwarding error'));
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    runLog.debug({ stderr: chunk.toString() }, 'Playwright stderr');
  });

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', (err) => {
      runLog.error({ err }, 'Child process error');
      resolve(1);
    });
  });

  clearTimeout(timeoutHandle);
  await canceler.unsubscribe();

  return { exitCode, timedOut, canceled };
}

// ── Docker strategy ───────────────────────────────────────────────────────────

async function runDocker(
  workDir: string,
  manifest: ShardManifest,
  shardIndex: number,
  shardTotal: number,
): Promise<SandboxResult> {
  const runLog = logger.child({ runId: manifest.runId, shardIndex, strategy: 'docker' });

  const shardArg = `--shard=${shardIndex + 1}/${shardTotal}`;

  // We use a deterministic container name so we can `docker stop` it by name
  const containerName = `sentinel-run-${manifest.runId}-shard-${shardIndex}`;

  const dockerArgs = [
    'run',
    '--rm',
    '--name', containerName,
    '--user', 'pwuser',
    '--read-only',
    '--tmpfs', '/tmp',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--cpus=${config.RUNNER_CPUS}`,
    `--memory=${config.RUNNER_MEMORY}`,
    `--memory-swap=${config.RUNNER_MEMORY}`,
    '--pids-limit=512',
    '--ulimit', 'nofile=4096',
    '--shm-size=1g',
    '-v', `${workDir}:/workspace`,
    '-w', '/workspace',
    `--network=${config.RUNNER_NETWORK}`,
    // Environment variables for the reporter
    '-e', `SENTINEL_RUN_ID=${manifest.runId}`,
    '-e', `SENTINEL_SHARD_INDEX=${shardIndex}`,
    '-e', `SENTINEL_PW_VERSION=${PLAYWRIGHT_VERSION}`,
    '-e', 'CI=1',
    config.PLAYWRIGHT_IMAGE,
    'npx', 'playwright', 'test', shardArg,
  ];

  runLog.info(
    { image: config.PLAYWRIGHT_IMAGE, containerName },
    'Spawning Docker container',
  );

  const proc = spawn('docker', dockerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let timedOut = false;
  let canceled = false;

  // Hard wall-clock cap
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    runLog.warn(
      { limitMs: config.RUN_MAX_DURATION_MS, containerName },
      'Run exceeded wall-clock limit — stopping container',
    );
    killContainer(containerName, runLog);
  }, config.RUN_MAX_DURATION_MS);
  timeoutHandle.unref();

  // Cancel subscription
  const canceler = await watchCancel(manifest.runId, () => {
    canceled = true;
    runLog.info({ containerName }, 'Cancellation signal received — stopping container');
    killContainer(containerName, runLog);
  });

  // Forward events from stdout
  if (proc.stdout) {
    parseAndForwardEvents(
      proc.stdout,
      manifest.runId,
      shardIndex,
      config.API_INTERNAL_URL,
      config.RUNNER_TOKEN,
      manifest.environment.secrets,
    ).catch((err) => runLog.warn({ err }, 'Event forwarding error'));
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    runLog.debug({ stderr: chunk.toString() }, 'Docker stderr');
  });

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', (err) => {
      runLog.error({ err }, 'Docker spawn error');
      resolve(1);
    });
  });

  clearTimeout(timeoutHandle);
  await canceler.unsubscribe();

  return { exitCode, timedOut, canceled };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeSandbox(
  workDir: string,
  manifest: ShardManifest,
  shardIndex: number,
  shardTotal: number,
): Promise<SandboxResult> {
  if (config.SANDBOX_STRATEGY === 'local') {
    return runLocal(workDir, manifest, shardIndex, shardTotal);
  }
  return runDocker(workDir, manifest, shardIndex, shardTotal);
}
