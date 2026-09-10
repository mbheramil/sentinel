'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2Icon, TrendingUpIcon, ZapIcon, ClockIcon, BellOffIcon } from 'lucide-react';
import { apiClient, type FlakyTestInsightResponse, type SlowestTestInsightResponse } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ── Helper functions ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Pass-rate bar chart (pure SVG) ────────────────────────────────────────────

interface PassRateChartProps {
  data: { date: string; passRate: number; total: number; passed: number; failed: number }[];
}

function PassRateChart({ data }: PassRateChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No data available.
      </div>
    );
  }

  const chartH = 80;
  const chartW = 600;
  const barCount = data.length;
  const barGap = 4;
  const barW = Math.max(4, (chartW - barGap * (barCount + 1)) / barCount);

  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto" aria-label="14-day pass-rate chart" role="img">
        <svg
          viewBox={`0 0 ${chartW} ${chartH + 24}`}
          className="w-full"
          aria-hidden="true"
          focusable="false"
        >
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={pct}
              x1={0}
              y1={(1 - pct / 100) * chartH}
              x2={chartW}
              y2={(1 - pct / 100) * chartH}
              className="stroke-border"
              strokeWidth={0.5}
              strokeDasharray={pct === 0 || pct === 100 ? undefined : '3 3'}
            />
          ))}

          {/* Bars */}
          {data.map((d, i) => {
            const x = barGap + i * (barW + barGap);
            const barH = Math.max(2, d.passRate * chartH);
            const y = chartH - barH;
            const isHovered = hoveredIdx === i;
            const passColor = d.passRate >= 0.9
              ? '#10b981'   // emerald-500
              : d.passRate >= 0.7
              ? '#f59e0b'   // amber-500
              : '#f43f5e';  // rose-500

            return (
              <g key={d.date}>
                {/* Background bar */}
                <rect
                  x={x}
                  y={0}
                  width={barW}
                  height={chartH}
                  fill={isHovered ? 'rgba(0,0,0,0.05)' : 'transparent'}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
                {/* Pass bar */}
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  fill={passColor}
                  rx={2}
                  opacity={isHovered ? 1 : 0.85}
                  style={{ pointerEvents: 'none' }}
                />
                {/* Date label */}
                <text
                  x={x + barW / 2}
                  y={chartH + 16}
                  textAnchor="middle"
                  fontSize={8}
                  className="fill-muted-foreground"
                >
                  {formatDate(d.date).replace(' ', '\n')}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoveredIdx !== null && data[hoveredIdx] && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-card border border-border rounded-md shadow-md px-3 py-2 text-xs pointer-events-none z-10">
            <p className="font-semibold">{formatDate(data[hoveredIdx]!.date)}</p>
            <p className="text-muted-foreground">
              Pass rate:{' '}
              <span className="text-foreground font-medium">
                {(data[hoveredIdx]!.passRate * 100).toFixed(1)}%
              </span>
            </p>
            <p className="text-muted-foreground">
              {data[hoveredIdx]!.passed} passed / {data[hoveredIdx]!.failed} failed /{' '}
              {data[hoveredIdx]!.total} total
            </p>
          </div>
        )}
      </div>

      {/* Y-axis legend */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ── Flaky tests table ─────────────────────────────────────────────────────────

interface FlakyTestsTableProps {
  tests: FlakyTestInsightResponse[];
  projectSlug: string;
  onMute: (testId: string) => void;
  mutingId: string | null;
}

function FlakyTestsTable({ tests, projectSlug, onMute, mutingId }: FlakyTestsTableProps) {
  if (tests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No flaky tests in the last 7 days.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Test</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">Flake %</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">Browser</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">p95</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-16">Runs 7d</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-20">Action</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={`${t.testId}-${t.browser}`} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
              <td className="px-4 py-2.5">
                <Link
                  href={`/projects/${projectSlug}/tests/${t.testId}`}
                  className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {t.testName}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                {/* Flake score bar */}
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 rounded-full bg-amber-200 dark:bg-amber-900/50 overflow-hidden w-16"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${Math.min(t.flakeScore * 100, 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs font-medium">
                    {(t.flakeScore * 100).toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs">{t.browser}</td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                {formatDuration(t.p95DurationMs)}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{t.runs7d}</td>
              <td className="px-4 py-2.5 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onMute(t.testId)}
                  disabled={mutingId === t.testId}
                  aria-label={`Mute ${t.testName}`}
                  className="h-7 text-xs"
                >
                  {mutingId === t.testId ? (
                    <Loader2Icon className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <BellOffIcon className="h-3 w-3" aria-hidden="true" />
                  )}
                  Mute
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Slowest tests table ───────────────────────────────────────────────────────

interface SlowestTestsTableProps {
  tests: SlowestTestInsightResponse[];
  projectSlug: string;
}

function SlowestTestsTable({ tests, projectSlug }: SlowestTestsTableProps) {
  if (tests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">No data.</p>
    );
  }

  const maxP95 = Math.max(...tests.map((t) => t.p95DurationMs), 1);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Test</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-32">p95</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">p50</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">Browser</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={`${t.testId}-${t.browser}`} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
              <td className="px-4 py-2.5">
                <Link
                  href={`/projects/${projectSlug}/tests/${t.testId}`}
                  className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {t.testName}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 rounded-full bg-muted overflow-hidden w-20"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(t.p95DurationMs / maxP95) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs font-medium">
                    {formatDuration(t.p95DurationMs)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                {formatDuration(t.p50DurationMs)}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs">{t.browser}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ slug: string }>;
}

export default function InsightsPage({ params }: Props) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const [mutingId, setMutingId] = useState<string | null>(null);

  const { data: insights, isLoading, isError } = useQuery({
    queryKey: ['project-insights', slug],
    queryFn: () => apiClient.getProjectInsights(slug),
    staleTime: 5 * 60 * 1000,
  });

  const muteMutation = useMutation({
    mutationFn: (testId: string) =>
      apiClient.updateTest(slug, testId, { isMuted: true }),
    onMutate: (testId) => setMutingId(testId),
    onSettled: () => {
      setMutingId(null);
      void qc.invalidateQueries({ queryKey: ['project-insights', slug] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">
          {slug}
        </Link>
        {' / '}
        <span className="text-foreground">Insights</span>
      </nav>

      <h1 className="text-xl font-semibold">Insights</h1>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load insights. Please refresh.</p>
          </CardContent>
        </Card>
      )}

      {insights && (
        <>
          {/* Pass rate trend */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <TrendingUpIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">Pass rate — last 14 days</CardTitle>
            </CardHeader>
            <CardContent>
              <PassRateChart data={insights.passRateTrend} />
            </CardContent>
          </Card>

          {/* Flakiest tests */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <ZapIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <CardTitle className="text-base">Flakiest tests — last 7 days</CardTitle>
            </CardHeader>
            <CardContent>
              <FlakyTestsTable
                tests={insights.flakyTests}
                projectSlug={slug}
                onMute={(testId) => muteMutation.mutate(testId)}
                mutingId={mutingId}
              />
            </CardContent>
          </Card>

          {/* Slowest tests */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <ClockIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">Slowest tests</CardTitle>
            </CardHeader>
            <CardContent>
              <SlowestTestsTable
                tests={insights.slowestTests}
                projectSlug={slug}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
