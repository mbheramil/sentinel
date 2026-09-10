'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2Icon, ListIcon } from 'lucide-react';
import { apiClient, type RunResponse } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import type { RunStatus } from '@sentinel/shared';

interface Props {
  params: Promise<{ slug: string }>;
}

const FILTER_OPTIONS: { label: string; value: RunStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Passed', value: 'PASSED' },
  { label: 'Failed', value: 'FAILED' },
];

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function RunRow({ run, slug }: { run: RunResponse; slug: string }) {
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <StatusBadge status={run.status} size="sm" />
      </td>
      <td className="px-4 py-3 text-sm capitalize">{run.trigger.toLowerCase()}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {run.environment?.name ?? run.environmentId.slice(-8)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {run.browsers.join(', ')}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
        {formatDuration(run.durationMs)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/projects/${slug}/runs/${run.id}`}
          className="text-sm text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          View
        </Link>
      </td>
    </tr>
  );
}

export default function RunsPage({ params }: Props) {
  const { slug } = use(params);
  const [filter, setFilter] = useState<RunStatus | 'ALL'>('ALL');

  const { data: runs, isLoading, isError } = useQuery({
    queryKey: ['runs', slug, filter],
    queryFn: () =>
      apiClient.getRuns(slug, filter !== 'ALL' ? { status: filter } : undefined),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">
              {slug}
            </Link>{' '}
            / runs
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-4" role="group" aria-label="Filter runs by status">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            aria-pressed={filter === opt.value}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load runs. Please refresh.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && runs && runs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <ListIcon className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground font-medium">
              {filter !== 'ALL' ? `No ${filter.toLowerCase()} runs` : 'No runs yet'}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && runs && runs.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Trigger</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Environment</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Browsers</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} slug={slug} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
