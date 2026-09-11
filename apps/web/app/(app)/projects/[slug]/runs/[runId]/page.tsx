'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2Icon, XIcon, GitBranchIcon, MonitorIcon, RefreshCwIcon, TerminalIcon, GlobeIcon } from 'lucide-react';
import { apiClient, type RunTestResponse } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { LiveLog } from '@/components/live-log';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TestStatus } from '@sentinel/shared';

interface Props {
  params: Promise<{ slug: string; runId: string }>;
}

type TestFilter = 'ALL' | 'FAILED' | 'FLAKY' | 'MUTED';

const TEST_FILTERS: { label: string; value: TestFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Flaky', value: 'FLAKY' },
  { label: 'Muted', value: 'MUTED' },
];

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function groupByFile(tests: RunTestResponse[]): Map<string, RunTestResponse[]> {
  const map = new Map<string, RunTestResponse[]>();
  for (const t of tests) {
    const file = t.filePath ?? 'unknown';
    const arr = map.get(file) ?? [];
    arr.push(t);
    map.set(file, arr);
  }
  return map;
}

function ShardProgress({ runId }: { runId: string }) {
  const { data: shards } = useQuery({
    queryKey: ['run-shards', runId],
    queryFn: () => apiClient.getRunShards(runId),
    refetchInterval: 3000,
  });

  if (!shards || shards.length <= 1) return null;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Shards ({shards.length})</CardTitle>
      </CardHeader>
      <CardContent className="pb-4 space-y-2">
        {shards.map((shard) => (
          <div key={shard.id} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-16 shrink-0">
              Shard {shard.index + 1}/{shard.total}
            </span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  shard.status === 'PASSED' ? 'bg-status-passed' :
                  shard.status === 'FAILED' ? 'bg-status-failed' :
                  shard.status === 'RUNNING' ? 'bg-status-running animate-pulse' :
                  'bg-muted-foreground/30'
                }`}
                style={{ width: shard.status === 'QUEUED' ? '0%' : '100%' }}
                aria-label={`Shard ${shard.index + 1}: ${shard.status}`}
              />
            </div>
            <StatusBadge status={shard.status} size="sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function RunDetailPage({ params }: Props) {
  const { slug, runId } = use(params);
  const qc = useQueryClient();
  const [testFilter, setTestFilter] = useState<TestFilter>('ALL');

  const { data: run, isLoading, isError } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => apiClient.getRun(runId),
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && ['PASSED', 'FAILED', 'CANCELED', 'ERROR', 'TIMED_OUT'].includes(d.status)
        ? false
        : 5000;
    },
  });

  const { data: runTests } = useQuery({
    queryKey: ['run-tests', runId, testFilter],
    queryFn: () =>
      apiClient.getRunTests(
        runId,
        testFilter !== 'ALL'
          ? { status: testFilter === 'MUTED' ? 'muted' : (testFilter.toLowerCase() as TestStatus) }
          : undefined,
      ),
    enabled: !!run,
    refetchInterval: run && !['PASSED', 'FAILED', 'CANCELED', 'ERROR', 'TIMED_OUT'].includes(run.status)
      ? 5000
      : false,
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiClient.cancelRun(runId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['run', runId] }),
    onError: (err) => alert(`Cancel failed: ${err instanceof Error ? err.message : 'unknown error'}`),
  });

  const retryMutation = useMutation({
    mutationFn: () => apiClient.retryRun(runId, true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['run', runId] });
      void qc.invalidateQueries({ queryKey: ['run-tests', runId] });
      void qc.invalidateQueries({ queryKey: ['runs', slug] });
    },
    onError: (err) => alert(`Retry failed: ${err instanceof Error ? err.message : 'unknown error'}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load run. Please refresh.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isActive = ['QUEUED', 'RUNNING'].includes(run.status);
  const grouped = runTests ? groupByFile(runTests) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
            <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">{slug}</Link>
            {' / '}
            <Link href={`/projects/${slug}/runs`} className="hover:underline focus-visible:underline">Runs</Link>
            {' / '}
            <span className="text-foreground font-mono">{runId.slice(-12)}</span>
          </nav>
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={run.status} />
            <span className="text-sm text-muted-foreground capitalize">{run.trigger.toLowerCase()}</span>
            {run.gitRef && (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-mono">
                <GitBranchIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {run.gitRef}
              </span>
            )}
            {run.browsers.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MonitorIcon className="h-3 w-3" aria-hidden="true" />
                {b}
              </span>
            ))}
            <span className="text-sm text-muted-foreground font-mono">{formatDuration(run.durationMs)}</span>
          </div>
          {/* Totals */}
          {run.totals && Object.keys(run.totals).length > 0 && (
            <div className="flex gap-3 text-sm flex-wrap">
              {run.totals.passed !== undefined && run.totals.passed > 0 && (
                <span className="text-status-passed font-medium">{run.totals.passed} passed</span>
              )}
              {run.totals.failed !== undefined && run.totals.failed > 0 && (
                <span className="text-status-failed font-medium">{run.totals.failed} failed</span>
              )}
              {run.totals.flaky !== undefined && run.totals.flaky > 0 && (
                <span className="text-status-flaky font-medium">{run.totals.flaky} flaky</span>
              )}
              {run.totals.skipped !== undefined && run.totals.skipped > 0 && (
                <span className="text-status-skipped font-medium">{run.totals.skipped} skipped</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Retry failed — always visible for finished runs */}
          {['PASSED', 'FAILED', 'CANCELED', 'ERROR', 'TIMED_OUT'].includes(run.status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              aria-label="Retry failed tests"
            >
              {retryMutation.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
              )}
              Retry failed
            </Button>
          )}

          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <XIcon className="h-4 w-4" aria-hidden="true" />
              )}
              Cancel run
            </Button>
          )}
        </div>
      </div>

      {/* Shard progress */}
      <ShardProgress runId={runId} />

      {/* Live log */}
      <section aria-label="Run log">
        <h2 className="text-sm font-semibold mb-2">Live log</h2>
        <LiveLog runId={runId} />
      </section>

      {/* Test results */}
      <section aria-label="Test results">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Test results</h2>
          <div className="flex gap-2" role="group" aria-label="Filter test results">
            {TEST_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setTestFilter(f.value)}
                aria-pressed={testFilter === f.value}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${testFilter === f.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!runTests && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        )}

        {runTests && runTests.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No test results yet.</p>
            </CardContent>
          </Card>
        )}

        {runTests && runTests.length > 0 && grouped && (
          <div className="space-y-4">
            {Array.from(grouped.entries()).map(([file, tests]) => (
              <div key={file} className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center gap-2 bg-muted/30 px-4 py-2 border-b border-border">
                  <span className="font-mono text-xs text-muted-foreground truncate" title={file}>{file}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{tests.length} test{tests.length > 1 ? 's' : ''}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {tests.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 w-8">
                          <StatusBadge status={t.status} size="sm" label="" className="border-0 bg-transparent px-0" />
                        </td>
                        <td className="px-2 py-2.5 font-medium">
                          <div className="flex flex-col gap-0.5">
                            <span>{t.testName ?? t.id.slice(-12)}</span>
                            {t.finalUrl && (
                              <a
                                href={t.finalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground font-mono hover:text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none truncate max-w-xs"
                                title={t.finalUrl}
                              >
                                {t.finalUrl}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-muted-foreground text-xs">{t.browser}</td>
                        <td className="px-2 py-2.5 text-muted-foreground text-xs font-mono">{formatDuration(t.durationMs)}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {t.consoleErrorCount !== undefined && t.consoleErrorCount > 0 && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                title={`${t.consoleErrorCount} console error${t.consoleErrorCount > 1 ? 's' : ''}`}
                                aria-label={`${t.consoleErrorCount} console errors`}
                              >
                                <TerminalIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                {t.consoleErrorCount}
                              </span>
                            )}
                            {t.networkErrorCount !== undefined && t.networkErrorCount > 0 && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                title={`${t.networkErrorCount} network error${t.networkErrorCount > 1 ? 's' : ''}`}
                                aria-label={`${t.networkErrorCount} network errors`}
                              >
                                <GlobeIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                {t.networkErrorCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {t.firstAttemptId ? (
                            <Link
                              href={`/projects/${slug}/runs/${runId}/attempts/${t.firstAttemptId}`}
                              className="text-xs text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                            >
                              View attempt
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">No attempt</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
