'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertCircleIcon, ServerIcon, DatabaseIcon, RefreshCwIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface RunnerInfo {
  runnerId: string;
  slots: { used: number; max: number };
  queueDepth: number;
  lastSeenAt: string | null;
}

interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
}

interface StuckRun {
  id: string;
  status: string;
  startedAt: string | null;
  project: { id: string; name: string };
}

interface AdminOverview {
  runners: RunnerInfo[];
  queues: { runs: QueueStats; schedules: QueueStats };
  stuckRuns: StuckRun[];
  dbStats: { totalRuns: number; totalTests: number; artifactGb: number };
}

// ── Data fetching ────────────────────────────────────────────────────────────

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

async function fetchOverview(): Promise<AdminOverview> {
  const res = await fetch(`${API_BASE}/admin/overview`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AdminOverview>;
}

async function forceFail(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/runs/${runId}/force-fail`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
}

// ── Helper components ────────────────────────────────────────────────────────

function StatusChip({ ok }: { ok: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        ok
          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      ].join(' ')}
      aria-label={ok ? 'healthy' : 'unhealthy'}
    >
      {ok ? 'Healthy' : 'Stale'}
    </span>
  );
}

function QueueCard({ label, stats }: { label: string; stats: QueueStats }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{label}</h3>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          { key: 'Waiting', val: stats.waiting },
          { key: 'Active', val: stats.active },
          { key: 'Delayed', val: stats.delayed },
        ].map(({ key, val }) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{key}</dt>
            <dd className="text-lg font-bold tabular-nums text-foreground">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<AdminOverview, Error>({
    queryKey: ['admin-overview'],
    queryFn: fetchOverview,
    refetchInterval: 30_000,
  });

  const forceFailMutation = useMutation({
    mutationFn: (runId: string) => forceFail(runId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <RefreshCwIcon className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="m-8 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
      >
        <AlertCircleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{error?.message ?? 'Failed to load admin overview'}</span>
      </div>
    );
  }

  const overview = data!;
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
        <button
          type="button"
          onClick={() => { void qc.invalidateQueries({ queryKey: ['admin-overview'] }); }}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Refresh"
        >
          <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* DB Stats */}
      <section aria-labelledby="db-stats-heading">
        <h2 id="db-stats-heading" className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <DatabaseIcon className="h-5 w-5" aria-hidden="true" />
          Database Stats
        </h2>
        <dl className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Runs', value: overview.dbStats.totalRuns.toLocaleString() },
            { label: 'Total Tests', value: overview.dbStats.totalTests.toLocaleString() },
            { label: 'Artifact Storage', value: `${overview.dbStats.artifactGb} GB` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Queue Depths */}
      <section aria-labelledby="queues-heading">
        <h2 id="queues-heading" className="mb-4 text-lg font-semibold text-foreground">
          Queue Depths
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <QueueCard label="Runs queue" stats={overview.queues.runs} />
          <QueueCard label="Schedules queue" stats={overview.queues.schedules} />
        </div>
      </section>

      {/* Runner Health */}
      <section aria-labelledby="runners-heading">
        <h2 id="runners-heading" className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <ServerIcon className="h-5 w-5" aria-hidden="true" />
          Runner Health
        </h2>
        {overview.runners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active runners detected.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Runner ID</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Slots used / max</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Queue depth</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Last heartbeat</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.runners.map((runner) => {
                  const lastSeen = runner.lastSeenAt ? parseISO(runner.lastSeenAt) : null;
                  const isHealthy = lastSeen ? lastSeen > twoMinutesAgo : false;
                  return (
                    <tr key={runner.runnerId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {runner.runnerId}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {runner.slots.used} / {runner.slots.max}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">{runner.queueDepth}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lastSeen
                          ? formatDistanceToNow(lastSeen, { addSuffix: true })
                          : 'Unknown'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip ok={isHealthy} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Stuck Runs */}
      <section aria-labelledby="stuck-runs-heading">
        <h2 id="stuck-runs-heading" className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <AlertCircleIcon className="h-5 w-5 text-yellow-500" aria-hidden="true" />
          Stuck Runs
          {overview.stuckRuns.length > 0 && (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
              {overview.stuckRuns.length}
            </span>
          )}
        </h2>
        {overview.stuckRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stuck runs. All clear.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Run ID</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Project</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Started</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Duration</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.stuckRuns.map((run) => {
                  const startedAt = run.startedAt ? parseISO(run.startedAt) : null;
                  const durationMs = startedAt ? Date.now() - startedAt.getTime() : null;
                  const durationHours = durationMs ? Math.floor(durationMs / 3_600_000) : null;
                  const durationMins = durationMs
                    ? Math.floor((durationMs % 3_600_000) / 60_000)
                    : null;

                  return (
                    <tr key={run.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{run.id}</td>
                      <td className="px-4 py-3 text-foreground">{run.project.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {startedAt ? formatDistanceToNow(startedAt, { addSuffix: true }) : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {durationHours !== null && durationMins !== null
                          ? `${durationHours}h ${durationMins}m`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => { forceFailMutation.mutate(run.id); }}
                          disabled={forceFailMutation.isPending}
                          className="rounded bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          aria-label={`Force fail run ${run.id}`}
                        >
                          Force fail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
