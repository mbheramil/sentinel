import type { RunStatus, TestStatus, RunTrigger, AuthoringMode } from '@sentinel/shared';

const BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

// ─── Response shapes ────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  defaultBrowsers: string[];
  defaultTimeoutMs: number;
  defaultRetries: number;
  concurrency: number;
  artifactRetentionDays: number;
}

export interface EnvironmentResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  variables: Record<string, string>;
}

export interface RunResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  suiteId: string | null;
  environmentId: string;
  trigger: RunTrigger;
  status: RunStatus;
  browsers: string[];
  shardCount: number;
  gitRef: string | null;
  gitSha: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  totals: {
    total?: number;
    passed?: number;
    failed?: number;
    flaky?: number;
    skipped?: number;
    muted?: number;
    timedOut?: number;
  };
  errorMessage: string | null;
  environment?: EnvironmentResponse;
}

export interface RunShardResponse {
  id: string;
  runId: string;
  index: number;
  total: number;
  status: RunStatus;
  runnerId: string | null;
  finishedAt: string | null;
}

export interface TestCaseResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  name: string;
  description: string | null;
  authoringMode: AuthoringMode;
  filePath: string;
  code: string;
  stepsIr: unknown | null;
  tags: string[];
  isMuted: boolean;
  isArchived: boolean;
  currentVersionId: string | null;
}

export interface CompileWarning {
  stepIndex: number;
  message: string;
  severity: 'warn' | 'info';
}

export interface CompileIrResponse {
  code: string;
  warnings: CompileWarning[];
}

export interface TestVersionResponse {
  id: string;
  createdAt: string;
  testCaseId: string;
  version: number;
  code: string;
  message: string | null;
}

export interface RunTestResponse {
  id: string;
  runId: string;
  testCaseId: string;
  browser: string;
  projectLabel: string;
  status: TestStatus;
  durationMs: number | null;
  filePath?: string;
  testName?: string;
  finalUrl?: string | null;
  consoleErrorCount?: number;
  networkErrorCount?: number;
  attemptCount?: number;
  firstAttemptId?: string | null;
}

export interface AttemptResponse {
  id: string;
  createdAt: string;
  runTestId: string;
  index: number;
  status: TestStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  errorSnippet: string | null;
  expectedText: string | null;
  actualText: string | null;
  finalUrl: string | null;
  stdout: string | null;
  stderr: string | null;
  consoleErrorCount: number;
  networkErrorCount: number;
  steps?: StepResultResponse[];
  artifacts?: ArtifactResponse[];
}

export interface StepResultResponse {
  id: string;
  attemptId: string;
  parentId: string | null;
  position: number;
  depth: number;
  title: string;
  category: string;
  status: TestStatus;
  durationMs: number | null;
  errorMessage: string | null;
  selector: string | null;
  httpStatus: number | null;
}

export type ArtifactType = 'SCREENSHOT' | 'VIDEO' | 'TRACE' | 'CONSOLE_LOG' | 'NETWORK_LOG';

export interface ArtifactResponse {
  id: string;
  createdAt: string;
  attemptId: string;
  type: ArtifactType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ArtifactUrlResponse {
  url: string;
  expiresAt: string;
}

export interface TestHistoryItemResponse {
  runId: string;
  attemptId: string;
  status: TestStatus;
  durationMs: number | null;
  startedAt: string | null;
  browser: string;
}

export interface InsightsDayResponse {
  date: string;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
}

export interface FlakyTestInsightResponse {
  testId: string;
  testName: string;
  flakeScore: number;
  browser: string;
  p95DurationMs: number;
  runs7d: number;
}

export interface SlowestTestInsightResponse {
  testId: string;
  testName: string;
  browser: string;
  p95DurationMs: number;
  p50DurationMs: number;
}

export interface ProjectInsightsResponse {
  passRateTrend: InsightsDayResponse[];
  flakyTests: FlakyTestInsightResponse[];
  slowestTests: SlowestTestInsightResponse[];
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
  defaultBrowsers?: string[];
}

export interface CreateRunInput {
  environmentId: string;
  browsers?: string[];
  shardCount?: number;
  suiteId?: string;
  testCaseIds?: string[];
  gitRef?: string;
}

export interface CreateEnvironmentInput {
  name: string;
  baseUrl: string;
  isDefault?: boolean;
  variables?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface ValidateTestResponse {
  valid: boolean;
  diagnostics: Array<{ line: number; col: number; message: string; severity: 'error' | 'warning' }>;
}

export interface GenerateTestResponse {
  stepsIr: unknown;
  code: string;
  explanation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TriageResponse {
  likelyCause: string;
  confidence: 'high' | 'medium' | 'low';
  suggestion: string;
  fromCache: boolean;
  disclaimer: string;
}

export interface AiUsageWeek {
  week: string;
  totalCostUsdMicro: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}

export interface AiUsageResponse {
  weeks: AiUsageWeek[];
}

// ─── Client implementation ───────────────────────────────────────────────────

class SentinelApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SentinelApiError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: ApiError };
      if (body.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // ignore parse error
    }
    throw new SentinelApiError(code, message, res.status);
  }

  return res.json() as Promise<T>;
}

// ─── Typed API methods ───────────────────────────────────────────────────────

export const apiClient = {
  // Projects
  getProjects(): Promise<ProjectResponse[]> {
    return request<ProjectResponse[]>('/projects');
  },

  createProject(input: CreateProjectInput): Promise<ProjectResponse> {
    return request<ProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getProject(slug: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/projects/${slug}`);
  },

  updateProject(slug: string, input: Partial<CreateProjectInput>): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/projects/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  // Environments
  getEnvironments(projectSlug: string): Promise<EnvironmentResponse[]> {
    return request<EnvironmentResponse[]>(`/projects/${projectSlug}/environments`);
  },

  createEnvironment(
    projectSlug: string,
    input: CreateEnvironmentInput,
  ): Promise<EnvironmentResponse> {
    return request<EnvironmentResponse>(`/projects/${projectSlug}/environments`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateEnvironment(
    projectSlug: string,
    envId: string,
    input: Partial<CreateEnvironmentInput>,
  ): Promise<EnvironmentResponse> {
    return request<EnvironmentResponse>(`/projects/${projectSlug}/environments/${envId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  deleteEnvironment(projectSlug: string, envId: string): Promise<void> {
    return request<void>(`/projects/${projectSlug}/environments/${envId}`, {
      method: 'DELETE',
    });
  },

  // Tests
  getTests(projectSlug: string): Promise<TestCaseResponse[]> {
    return request<TestCaseResponse[]>(`/projects/${projectSlug}/tests`);
  },

  getTest(_projectSlug: string, testId: string): Promise<TestCaseResponse> {
    return request<TestCaseResponse>(`/tests/${testId}`);
  },

  createTest(
    projectSlug: string,
    input: { name: string; filePath: string; code: string; tags?: string[] },
  ): Promise<TestCaseResponse> {
    return request<TestCaseResponse>(`/projects/${projectSlug}/tests`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateTest(
    _projectSlug: string,
    testId: string,
    input: Partial<{
      name: string;
      code: string;
      stepsIr: unknown;
      authoringMode: AuthoringMode;
      tags: string[];
      isMuted: boolean;
    }>,
  ): Promise<TestCaseResponse> {
    return request<TestCaseResponse>(`/tests/${testId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  validateTest(testId: string): Promise<ValidateTestResponse> {
    return request<ValidateTestResponse>(`/tests/${testId}/validate`, {
      method: 'POST',
    });
  },

  getTestVersions(testId: string): Promise<TestVersionResponse[]> {
    return request<TestVersionResponse[]>(`/tests/${testId}/versions`);
  },

  saveTestVersion(
    testId: string,
    input: { code: string; stepsIr?: unknown; message?: string },
  ): Promise<TestVersionResponse> {
    return request<TestVersionResponse>(`/tests/${testId}/versions`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Builder
  compileIr(stepsIr: unknown): Promise<CompileIrResponse> {
    return request<CompileIrResponse>('/tests/compile-ir', {
      method: 'POST',
      body: JSON.stringify({ stepsIr }),
    });
  },

  updateTestAuthoringMode(
    testId: string,
    mode: AuthoringMode,
    code?: string,
  ): Promise<TestCaseResponse> {
    return request<TestCaseResponse>(`/tests/${testId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        authoringMode: mode,
        ...(code !== undefined ? { code } : {}),
      }),
    });
  },

  // Runs
  getRuns(
    projectSlug: string,
    params?: { status?: RunStatus; page?: number; pageSize?: number },
  ): Promise<RunResponse[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.pageSize !== undefined) qs.set('perPage', String(params.pageSize));
    const q = qs.toString();
    // The API returns { data: RunResponse[], meta: { page, perPage, total } }.
    return request<{ data: RunResponse[] }>(`/projects/${projectSlug}/runs${q ? `?${q}` : ''}`)
      .then((r) => r.data);
  },

  createRun(projectSlug: string, input: CreateRunInput): Promise<{ runId: string; status: string }> {
    return request<{ runId: string; status: string }>(`/projects/${projectSlug}/runs`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getRun(runId: string): Promise<RunResponse> {
    return request<RunResponse>(`/runs/${runId}`);
  },

  cancelRun(runId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: 'POST' });
  },

  getRunShards(runId: string): Promise<RunShardResponse[]> {
    return request<RunShardResponse[]>(`/runs/${runId}/shards`);
  },

  getRunTests(
    runId: string,
    params?: { status?: TestStatus | 'flaky' | 'muted' },
  ): Promise<RunTestResponse[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    const q = qs.toString();
    return request<RunTestResponse[]>(`/runs/${runId}/tests${q ? `?${q}` : ''}`);
  },

  getAttempt(attemptId: string): Promise<AttemptResponse> {
    return request<AttemptResponse>(`/attempts/${attemptId}`);
  },

  getRunTest(runTestId: string): Promise<RunTestResponse> {
    return request<RunTestResponse>(`/run-tests/${runTestId}`);
  },

  getArtifactUrl(artifactId: string): Promise<ArtifactUrlResponse> {
    return request<ArtifactUrlResponse>(`/artifacts/${artifactId}/url`);
  },

  getTestHistory(
    testId: string,
    params?: { browser?: string; limit?: number },
  ): Promise<TestHistoryItemResponse[]> {
    const qs = new URLSearchParams();
    if (params?.browser) qs.set('browser', params.browser);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<TestHistoryItemResponse[]>(`/tests/${testId}/history${q ? `?${q}` : ''}`);
  },

  getProjectInsights(projectSlug: string): Promise<ProjectInsightsResponse> {
    return request<ProjectInsightsResponse>(`/projects/${projectSlug}/insights`);
  },

  retryRun(runId: string, failedOnly?: boolean): Promise<{ runId: string; status: string }> {
    return request<{ runId: string; status: string }>(`/runs/${runId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ failedOnly: failedOnly ?? false }),
    });
  },

  // Auth
  signup(input: {
    name: string;
    email: string;
    password: string;
    orgName: string;
  }): Promise<{ userId: string; orgId: string }> {
    return request<{ userId: string; orgId: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // AI
  generateTest(input: {
    prompt: string;
    url?: string;
    deepMode?: boolean;
  }): Promise<GenerateTestResponse> {
    return request<GenerateTestResponse>('/tests/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  triageAttempt(attemptId: string): Promise<TriageResponse> {
    return request<TriageResponse>(`/attempts/${attemptId}/triage`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  getOrgAiUsage(orgId: string): Promise<AiUsageResponse> {
    return request<AiUsageResponse>(`/orgs/${orgId}/ai-usage`);
  },
};

export { SentinelApiError };
