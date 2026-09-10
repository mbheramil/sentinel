/**
 * Thin API client for the Sentinel REST API.
 * All requests are authenticated via Bearer token from keychain / env var.
 */
import { loadToken, loadApiUrl } from './config.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  overrideApiUrl?: string,
  overrideToken?: string,
): Promise<T> {
  const apiUrl = overrideApiUrl ?? (await loadApiUrl());
  if (!apiUrl) {
    throw new Error(
      'No API URL configured. Run `sentinel login` or set SENTINEL_API_URL.',
    );
  }

  const token = overrideToken ?? (await loadToken());

  const url = `${apiUrl.replace(/\/$/, '')}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': '@sentinel/cli',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as ErrorBody;
      code = errBody.error?.code ?? code;
      message = errBody.error?.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, code, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, apiUrl?: string, token?: string) =>
    request<T>('GET', path, undefined, apiUrl, token),

  post: <T>(path: string, body?: unknown, apiUrl?: string, token?: string) =>
    request<T>('POST', path, body, apiUrl, token),

  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, body),

  delete: <T>(path: string) =>
    request<T>('DELETE', path),
};

// ─── Typed helpers ────────────────────────────────────────────────────────

export interface RunStatus {
  id: string;
  projectId: string;
  status: string;
  trigger: string;
  browsers: string[];
  shardCount: number;
  totals: {
    total?: number;
    passed?: number;
    failed?: number;
    flaky?: number;
    skipped?: number;
    muted?: number;
    timedOut?: number;
  };
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  shards?: Array<{
    id: string;
    index: number;
    total: number;
    status: string;
  }>;
  runTests?: Array<{
    id: string;
    testCaseId: string;
    browser: string;
    status: string;
    durationMs: number | null;
    shardIndex: number;
  }>;
}

export const TERMINAL_STATUSES = new Set([
  'PASSED',
  'FAILED',
  'CANCELED',
  'ERROR',
  'TIMED_OUT',
]);

/**
 * Long-poll a run until it reaches a terminal status.
 * Calls onTick on each poll with the latest run data.
 */
export async function pollRun(
  runId: string,
  onTick: (run: RunStatus) => void,
  intervalMs = 3_000,
  timeoutMs = 30 * 60 * 1000,
): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const run = await api.get<RunStatus>(`/api/v1/runs/${runId}`);
    onTick(run);

    if (TERMINAL_STATUSES.has(run.status)) {
      return run;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for run ${runId} to complete`);
}
