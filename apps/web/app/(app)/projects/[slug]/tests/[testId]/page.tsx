'use client';

import { use, useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2Icon,
  SaveIcon,
  PlayIcon,
  ShieldCheckIcon,
  HistoryIcon,
  SettingsIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  XCircleIcon,
  SparklesIcon,
  LayoutIcon,
  XIcon,
} from 'lucide-react';
import { apiClient, SentinelApiError, type TestHistoryItemResponse, type GenerateTestResponse } from '@/lib/api-client';
import { WARNED_PATTERNS } from '@sentinel/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { GenerateDialog } from '@/components/ai/generate-dialog';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
      <Loader2Icon className="h-8 w-8 animate-spin text-slate-400" aria-hidden="true" />
    </div>
  ),
});

interface Props {
  params: Promise<{ slug: string; testId: string }>;
}

type RailTab = 'settings' | 'snippets' | 'history' | 'runs';

interface WarnedLine {
  lineNumber: number;
  message: string;
}

function findWarnedLines(code: string): WarnedLine[] {
  const lines = code.split('\n');
  const results: WarnedLine[] = [];
  lines.forEach((line, idx) => {
    for (const { pattern, message } of WARNED_PATTERNS) {
      if (pattern.test(line)) {
        results.push({ lineNumber: idx + 1, message });
      }
    }
  });
  return results;
}

function HistoryTab({ testId }: { testId: string }) {
  const { data: versions, isLoading } = useQuery({
    queryKey: ['test-versions', testId],
    queryFn: () => apiClient.getTestVersions(testId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 gap-2 px-3">
        <HistoryIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-xs text-muted-foreground text-center">No saved versions yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1 p-2">
      {versions.map((v) => (
        <li
          key={v.id}
          className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer text-sm"
        >
          <ChevronRightIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">v{v.version}</p>
            {v.message && <p className="text-xs text-muted-foreground truncate">{v.message}</p>}
            <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Tiny sparkline SVG ────────────────────────────────────────────────────────

function statusToY(status: string): number {
  const s = status.toLowerCase();
  if (s === 'passed') return 0;
  if (s === 'flaky') return 0.5;
  return 1; // failed / other
}

function statusToSparkColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'passed') return '#10b981'; // emerald-500
  if (s === 'flaky') return '#f59e0b';  // amber-500
  return '#f43f5e';                      // rose-500
}

interface SparklineProps {
  items: TestHistoryItemResponse[];
  height?: number;
}

function Sparkline({ items, height = 40 }: SparklineProps) {
  if (items.length < 2) return null;

  const w = 200;
  const h = height;
  const pad = 4;

  const points = items.map((item, i) => {
    const x = pad + (i / (items.length - 1)) * (w - pad * 2);
    const y = pad + statusToY(item.status) * (h - pad * 2);
    return { x, y, status: item.status };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const lastStatus = items[items.length - 1]?.status ?? 'failed';
  const lineColor = statusToSparkColor(lastStatus);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.7}
      />
      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2}
          fill={statusToSparkColor(p.status)}
        />
      ))}
    </svg>
  );
}

function RecentRunsTab({ testId }: { testId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['test-history', testId],
    queryFn: () => apiClient.getTestHistory(testId, { limit: 30 }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 gap-2 px-3">
        <PlayIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-xs text-muted-foreground text-center">No run history yet.</p>
      </div>
    );
  }

  const recent = history.slice(-5).reverse();

  function formatDur(ms: number | null): string {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function statusDot(status: string): string {
    const s = status.toLowerCase();
    if (s === 'passed') return 'bg-emerald-500';
    if (s === 'flaky') return 'bg-amber-400';
    return 'bg-rose-500';
  }

  return (
    <div className="p-3 space-y-4">
      {/* Sparkline — all 30 data points */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Last {history.length} runs
        </p>
        <Sparkline items={history} />
      </div>

      {/* Last 5 runs list */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          Recent
        </p>
        <ul className="space-y-1">
          {recent.map((item) => (
            <li key={item.attemptId}>
              <Link
                href={`/runs/${item.runId}/attempts/${item.attemptId}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${statusDot(item.status)}`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0 text-xs truncate">
                  {item.browser}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {formatDur(item.durationMs)}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {item.startedAt ? new Date(item.startedAt).toLocaleDateString() : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function TestEditorPage({ params }: Props) {
  const { slug, testId } = use(params);
  const qc = useQueryClient();
  const router = useRouter();

  const [code, setCode] = useState<string | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>('settings');
  const [validationErrors, setValidationErrors] = useState<
    Array<{ line: number; column: number; message: string }>
  >([]);
  const [validationWarnings, setValidationWarnings] = useState<
    Array<{ line: number; column: number; message: string }>
  >([]);
  const [saveVersionMsg, setSaveVersionMsg] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [switchBuilderModalOpen, setSwitchBuilderModalOpen] = useState(false);
  const originalCode = useRef<string>('');

  const { data: test, isLoading } = useQuery({
    queryKey: ['test', slug, testId],
    queryFn: () => apiClient.getTest(slug, testId),
  });

  // Initialise editor code once the test data arrives (TanStack Query v5 — no onSuccess)
  useEffect(() => {
    if (test && code === undefined) {
      setCode(test.code);
      originalCode.current = test.code;
    }
  }, [test, code]);

  const saveDraftMutation = useMutation({
    mutationFn: () =>
      apiClient.updateTest(slug, testId, { code: code ?? '' }),
    onSuccess: () => {
      setIsDirty(false);
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['test', slug, testId] });
    },
    onError: (err) => {
      setSaveError(err instanceof SentinelApiError ? err.message : 'Save failed.');
    },
  });

  const saveVersionMutation = useMutation({
    mutationFn: () =>
      apiClient.saveTestVersion(testId, { code: code ?? '', message: saveVersionMsg || undefined }),
    onSuccess: () => {
      setSaveVersionMsg('');
      void qc.invalidateQueries({ queryKey: ['test-versions', testId] });
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => apiClient.validateTest(testId),
    onSuccess: (result) => {
      setValidationErrors(result.errors);
      setValidationWarnings(result.warnings);
    },
  });

  const switchToBuilderMutation = useMutation({
    mutationFn: () =>
      apiClient.updateTestAuthoringMode(testId, 'BUILDER'),
    onSuccess: () => {
      setSwitchBuilderModalOpen(false);
      void qc.invalidateQueries({ queryKey: ['test', slug, testId] });
      router.push(`/projects/${slug}/tests/${testId}/builder`);
    },
    onError: (err) => {
      setSaveError(
        err instanceof SentinelApiError ? err.message : 'Failed to switch mode.',
      );
    },
  });

  const warnedLines: WarnedLine[] = code ? findWarnedLines(code) : [];

  const handleEditorChange = useCallback((value: string | undefined) => {
    setCode(value);
    setIsDirty(true);
  }, []);

  const RAIL_TABS: { id: RailTab; label: string; icon: React.ElementType }[] = [
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'snippets', label: 'Snippets', icon: ShieldCheckIcon },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'runs', label: 'Runs', icon: PlayIcon },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!test) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-destructive">Test not found.</p>
      </div>
    );
  }

  const displayCode = code ?? test.code;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Action bar */}
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 bg-background shrink-0">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground mr-2" aria-label="Breadcrumb">
          <Link href={`/projects/${slug}`} className="hover:text-foreground focus-visible:underline">
            {slug}
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/projects/${slug}/tests`} className="hover:text-foreground focus-visible:underline">
            Tests
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground font-medium truncate max-w-xs" title={test.name}>
            {test.name}
          </span>
        </nav>
        {isDirty && (
          <Badge variant="outline" className="text-xs ml-1">Unsaved</Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Builder link / switch button */}
          {test.authoringMode !== 'CODE' ? (
            <Link href={`/projects/${slug}/tests/${testId}/builder`}>
              <Button
                variant="outline"
                size="sm"
                aria-label="Open no-code builder"
              >
                <LayoutIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Builder
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSwitchBuilderModalOpen(true)}
              aria-label="Switch to no-code builder"
            >
              <LayoutIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Switch to Builder
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setGenerateDialogOpen(true)}
            aria-label="Generate test with AI"
          >
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Generate with AI
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
            aria-label="Validate test"
          >
            {validateMutation.isPending ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Validate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveDraftMutation.mutate()}
            disabled={saveDraftMutation.isPending || !isDirty}
            aria-label="Save draft (Cmd+S)"
          >
            {saveDraftMutation.isPending ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <SaveIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => saveVersionMutation.mutate()}
            disabled={saveVersionMutation.isPending}
            aria-label="Save as new version"
          >
            {saveVersionMutation.isPending ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <HistoryIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save version
          </Button>
        </div>
      </header>

      {/* Error / warning banners */}
      {saveError && (
        <div role="alert" className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive">
          <XCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {saveError}
        </div>
      )}
      {warnedLines.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {warnedLines.length} pattern warning{warnedLines.length > 1 ? 's' : ''}:{' '}
            {warnedLines.map((w) => `line ${w.lineNumber} — ${w.message}`).join('; ')}
          </span>
        </div>
      )}
      {validationErrors.length > 0 && (
        <div role="alert" className="flex items-start gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive">
          <XCircleIcon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {validationErrors.length} validation error{validationErrors.length > 1 ? 's' : ''}.{' '}
            {validationErrors.map((e) => `Line ${e.line}: ${e.message}`).join('; ')}
          </span>
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {validationWarnings.length} server warning{validationWarnings.length > 1 ? 's' : ''}.{' '}
            {validationWarnings.map((w) => `Line ${w.line}: ${w.message}`).join('; ')}
          </span>
        </div>
      )}

      {/* AI Generate Dialog */}
      <GenerateDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        existingCode={code ?? test.code}
        onSave={(result: GenerateTestResponse) => {
          setCode(result.code);
          setIsDirty(true);
        }}
      />

      {/* Main body: editor + rail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor — 70% */}
        <div className="flex-1 min-w-0" style={{ flexBasis: '70%' }}>
          <MonacoEditor
            height="100%"
            defaultLanguage="typescript"
            value={displayCode}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              wordWrap: 'off',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              tabSize: 2,
              insertSpaces: true,
              formatOnPaste: true,
              formatOnType: true,
            }}
          />
        </div>

        {/* Right rail — 30% */}
        <aside
          className="flex flex-col border-l border-border bg-background overflow-hidden"
          style={{ flexBasis: '30%', maxWidth: '400px', minWidth: '280px' }}
          aria-label="Test editor side panel"
        >
          {/* Rail tabs */}
          <div
            className="flex border-b border-border shrink-0"
            role="tablist"
            aria-label="Side panel tabs"
          >
            {RAIL_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={railTab === tab.id}
                  onClick={() => setRailTab(tab.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${railTab === tab.id ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Rail content */}
          <div className="flex-1 overflow-y-auto">
            {railTab === 'settings' && (
              <div className="p-3 space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">File path</p>
                  <p className="text-sm font-mono break-all">{test.filePath}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Authoring mode</p>
                  <StatusBadge status={test.authoringMode as 'passed'} label={test.authoringMode} size="sm" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tags</p>
                  {test.tags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {test.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Muted</p>
                  <p className="text-sm">{test.isMuted ? 'Yes — failures suppressed' : 'No'}</p>
                </div>
              </div>
            )}

            {railTab === 'snippets' && (
              <div className="p-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Common Playwright snippets — click to insert at cursor.
                </p>
                {[
                  { label: 'page.goto()', code: "await page.goto('https://example.com');" },
                  { label: 'getByRole()', code: "await page.getByRole('button', { name: 'Submit' }).click();" },
                  { label: 'expect visible', code: "await expect(page.getByText('Hello')).toBeVisible();" },
                  { label: 'fill input', code: "await page.getByLabel('Email').fill('test@example.com');" },
                  { label: 'screenshot', code: "await page.screenshot({ path: 'screenshot.png' });" },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="w-full text-left rounded-md border border-border px-3 py-2 text-xs font-mono hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    onClick={() => {
                      setCode((prev) => (prev ?? '') + '\n' + s.code);
                      setIsDirty(true);
                    }}
                  >
                    <span className="block text-[10px] font-sans text-muted-foreground mb-0.5">{s.label}</span>
                    {s.code}
                  </button>
                ))}
              </div>
            )}

            {railTab === 'history' && <HistoryTab testId={testId} />}
            {railTab === 'runs' && <RecentRunsTab testId={testId} />}
          </div>
        </aside>
      </div>

      {/* Switch to Builder confirmation modal */}
      {switchBuilderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Switch to Builder mode"
        >
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setSwitchBuilderModalOpen(false)}
          />
          <div className="relative bg-background rounded-lg border border-border shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="h-5 w-5 text-amber-500 shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Switch to Builder mode?</h2>
              </div>
              <button
                type="button"
                className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSwitchBuilderModalOpen(false)}
                aria-label="Cancel"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Switching to Builder mode will parse your code as step IR. This is
              one-way — once you edit in the Builder and save, hand-edits to the
              code will be lost.
            </p>
            {test.stepsIr == null && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded px-2.5 py-2">
                No step IR found for this test — the builder will start empty.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSwitchBuilderModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => switchToBuilderMutation.mutate()}
                disabled={switchToBuilderMutation.isPending}
                aria-label="Confirm switch to Builder mode"
              >
                {switchToBuilderMutation.isPending ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
