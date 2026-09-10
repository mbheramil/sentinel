// Manifest types for the Sentinel runner.
// The claim endpoint returns a ShardManifest describing exactly what
// this shard must execute.

export type Browser = 'CHROMIUM' | 'FIREFOX' | 'WEBKIT';

export interface TestFile {
  /** DB id of the RunTest row — used to report results back */
  runTestId: string;
  /** DB id of the test case */
  testCaseId: string;
  /** Relative path inside specs/ dir, e.g. "login.spec.ts" */
  filePath: string;
  /** Full TypeScript source */
  code: string;
}

export interface EnvironmentManifest {
  baseUrl: string;
  /** Non-secret environment variables (SENTINEL_VAR_*) */
  vars: Record<string, string>;
  /** Secret values (SENTINEL_SECRET_*) — redacted in logs */
  secrets: Record<string, string>;
}

export interface ShardManifest {
  runId: string;
  shortId: string;
  /** DB id of the RunShard record */
  shardId: string;
  /** 0-based index */
  shardIndex: number;
  shardTotal: number;
  browsers: Browser[];
  traceMode: 'on' | 'retain-on-failure' | 'off';
  /** Playwright worker count for this shard */
  workers: number;
  environment: EnvironmentManifest;
  tests: TestFile[];
  /** A unique email address scoped to this run for inbox testing */
  testEmail?: string;
}

export interface JobPayload {
  runId: string;
  shardId: string;
  shardIndex: number;
}

export interface SandboxResult {
  exitCode: number;
  timedOut: boolean;
  canceled: boolean;
}
