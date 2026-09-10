// Single source of truth for the Playwright version.
// The runner Docker image tag MUST match this.
export const PLAYWRIGHT_VERSION = '1.49.1';

export const SENTINEL_VAR_PREFIX = 'SENTINEL_VAR_';
export const SENTINEL_SECRET_PREFIX = 'SENTINEL_SECRET_';

export const MAX_CONSOLE_ENTRIES_PER_ATTEMPT = 2000;
export const MAX_NETWORK_ENTRIES_PER_ATTEMPT = 2000;
export const HEAD_ENTRIES_COUNT = 500;
export const TAIL_ENTRIES_COUNT = 1500;

export const MAX_STDOUT_BYTES_PER_ATTEMPT = 256 * 1024; // 256 KB

export const DEFAULT_RUN_MAX_DURATION_MS = 30 * 60 * 1000; // 30 min
export const DEFAULT_SHARD_HEARTBEAT_TIMEOUT_MS = 90 * 1000; // 90 s
export const DEFAULT_ARTIFACT_RETENTION_DAYS = 30;

export const API_KEY_PREFIX_LENGTH = 12;
export const API_KEY_BYTES = 32;

export const SSE_REPLAY_BATCH_SIZE = 100;
export const SSE_LIVE_DEBOUNCE_MS = 100; // ~10 Hz

export const SENTINEL_REPORTER_MARKER = '@@SENTINEL@@';

export const SUPPORTED_BROWSERS = ['CHROMIUM', 'FIREFOX', 'WEBKIT'] as const;

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
