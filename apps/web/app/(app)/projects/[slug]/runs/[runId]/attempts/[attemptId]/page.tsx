'use client';

import { use, useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Loader2Icon,
  MonitorIcon,
  ImageIcon,
  VideoIcon,
  TerminalIcon,
  GlobeIcon,
  AlertCircleIcon,
} from 'lucide-react';
import { apiClient, type ArtifactResponse } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { StepTimeline } from '@/components/step-timeline';
import { ArtifactLightbox, type LightboxScreenshot } from '@/components/artifact-lightbox';
import { ArtifactVideo } from '@/components/artifact-video';
import { OpenTrace } from '@/components/open-trace';
import { TriageCard } from '@/components/ai/triage-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Monaco DiffEditor — loaded lazily, server-side rendering disabled
const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="h-48 rounded-md bg-muted animate-pulse" aria-label="Loading diff editor" />
    ),
  },
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ slug: string; runId: string; attemptId: string }>;
}

type MainTab = 'console' | 'network' | 'stdout' | 'stderr';

interface ConsoleLogEntry {
  severity: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  location?: string;
  stepId?: string;
}

interface NetworkLogEntry {
  method: string;
  url: string;
  status: number | null;
  resourceType: string;
  timingMs: number | null;
  stepId?: string;
}

// ── Helper functions ──────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function parseNdjson<T>(text: string): T[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

// ── Screenshot gallery ────────────────────────────────────────────────────────

/** Fetches URLs for all screenshots in parallel and provides a lightbox. */
function ScreenshotGallery({ artifacts }: { artifacts: ArtifactResponse[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // useQueries fetches all URLs in parallel without violating Rules of Hooks
  const urlQueries = useQueries({
    queries: artifacts.map((a) => ({
      queryKey: ['artifact-url', a.id] as const,
      queryFn: () => apiClient.getArtifactUrl(a.id),
      staleTime: 4 * 60 * 1000,
    })),
  });

  const lightboxScreenshots: LightboxScreenshot[] = artifacts.flatMap((a, i) => {
    const url = urlQueries[i]?.data?.url;
    if (!url) return [];
    return [{ artifactId: a.id, url, filename: a.filename }];
  });

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {artifacts.map((artifact, i) => {
          const { data, isLoading } = urlQueries[i]!;
          if (isLoading) {
            return (
              <div
                key={artifact.id}
                className="h-24 w-full rounded-md bg-muted animate-pulse"
                aria-label="Loading screenshot"
              />
            );
          }
          if (!data) {
            return (
              <div
                key={artifact.id}
                className="h-24 w-full rounded-md bg-muted flex items-center justify-center"
              >
                <ImageIcon className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
              </div>
            );
          }
          // Map artifact index to lightbox index (only loaded ones are in list)
          const lbIdx = lightboxScreenshots.findIndex((s) => s.artifactId === artifact.id);
          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => setOpenIdx(lbIdx >= 0 ? lbIdx : null)}
              className="group relative h-24 w-full overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
              aria-label={`Open screenshot: ${artifact.filename}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.url}
                alt={artifact.filename}
                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
              />
              <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] font-mono px-1.5 py-0.5 truncate">
                {artifact.filename}
              </span>
            </button>
          );
        })}
      </div>

      <ArtifactLightbox
        screenshots={lightboxScreenshots}
        currentIndex={openIdx}
        onClose={() => setOpenIdx(null)}
        onNavigate={(idx) => setOpenIdx(idx)}
      />
    </>
  );
}

// ── Console log viewer ────────────────────────────────────────────────────────

function ConsoleLogViewer({ artifact }: { artifact: ArtifactResponse }) {
  const [filter, setFilter] = useState<string>('all');

  const { data: urlData, isLoading: urlLoading } = useQuery({
    queryKey: ['artifact-url', artifact.id],
    queryFn: () => apiClient.getArtifactUrl(artifact.id),
    staleTime: 4 * 60 * 1000,
  });

  const { data: entries, isLoading: contentLoading } = useQuery({
    queryKey: ['artifact-content', artifact.id],
    queryFn: async (): Promise<ConsoleLogEntry[]> => {
      const res = await fetch(urlData!.url);
      const text = await res.text();
      return parseNdjson<ConsoleLogEntry>(text);
    },
    enabled: !!urlData?.url,
    staleTime: 60_000,
  });

  const isLoading = urlLoading || contentLoading;

  function severityClass(s: ConsoleLogEntry['severity']): string {
    switch (s) {
      case 'error': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
      case 'warn': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'info': return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
      case 'debug': return 'bg-slate-100 text-slate-500 dark:bg-slate-900/30 dark:text-slate-400';
      default: return 'bg-muted text-muted-foreground';
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
        <TerminalIcon className="h-8 w-8 opacity-30" aria-hidden="true" />
        <p className="text-sm">No console entries.</p>
      </div>
    );
  }

  const severities = ['all', 'error', 'warn', 'info', 'log', 'debug'] as const;
  const filtered =
    filter === 'all' ? entries : entries.filter((e) => e.severity === filter);

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by severity">
        {severities.map((sev) => (
          <button
            key={sev}
            type="button"
            onClick={() => setFilter(sev)}
            aria-pressed={filter === sev}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${filter === sev ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
          >
            {sev}
            {sev !== 'all' && (
              <span className="ml-1 opacity-70">
                ({entries.filter((e) => e.severity === sev).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">Level</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Message</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-40">Location</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${severityClass(entry.severity)}`}>
                    {entry.severity}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono break-all">{entry.text}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[160px]" title={entry.location}>
                  {entry.location ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">No entries match the filter.</p>
        )}
      </div>
    </div>
  );
}

// ── Network log viewer ────────────────────────────────────────────────────────

function NetworkLogViewer({ artifact }: { artifact: ArtifactResponse }) {
  const [methodFilter, setMethodFilter] = useState<string>('all');

  const { data: urlData, isLoading: urlLoading } = useQuery({
    queryKey: ['artifact-url', artifact.id],
    queryFn: () => apiClient.getArtifactUrl(artifact.id),
    staleTime: 4 * 60 * 1000,
  });

  const { data: entries, isLoading: contentLoading } = useQuery({
    queryKey: ['artifact-content', artifact.id],
    queryFn: async (): Promise<NetworkLogEntry[]> => {
      const res = await fetch(urlData!.url);
      const text = await res.text();
      return parseNdjson<NetworkLogEntry>(text);
    },
    enabled: !!urlData?.url,
    staleTime: 60_000,
  });

  const isLoading = urlLoading || contentLoading;

  function statusClass(code: number | null): string {
    if (code == null) return 'bg-muted text-muted-foreground';
    if (code < 300) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    if (code < 400) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
        <GlobeIcon className="h-8 w-8 opacity-30" aria-hidden="true" />
        <p className="text-sm">No network entries.</p>
      </div>
    );
  }

  const methods = ['all', ...Array.from(new Set(entries.map((e) => e.method)))];
  const filtered =
    methodFilter === 'all' ? entries : entries.filter((e) => e.method === methodFilter);

  return (
    <div className="space-y-3">
      {/* Method filter */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by HTTP method">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethodFilter(m)}
            aria-pressed={methodFilter === m}
            className={`px-2.5 py-1 rounded-full text-xs font-medium font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${methodFilter === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24">Method</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">URL</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">Status</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24">Type</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono font-medium">{entry.method}</td>
                <td className="px-3 py-2 font-mono truncate max-w-xs" title={entry.url}>
                  {entry.url}
                </td>
                <td className="px-3 py-2">
                  {entry.status != null ? (
                    <span className={`inline-block px-1.5 py-0.5 rounded font-mono font-medium ${statusClass(entry.status)}`}>
                      {entry.status}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{entry.resourceType}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {entry.timingMs != null ? `${entry.timingMs}ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">No entries match the filter.</p>
        )}
      </div>
    </div>
  );
}

// ── Accessible tab bar ─────────────────────────────────────────────────────────

const MAIN_TABS: { id: MainTab; label: string; icon: React.ElementType }[] = [
  { id: 'console', label: 'Console', icon: TerminalIcon },
  { id: 'network', label: 'Network', icon: GlobeIcon },
  { id: 'stdout', label: 'Stdout', icon: TerminalIcon },
  { id: 'stderr', label: 'Stderr', icon: AlertCircleIcon },
];

interface TabBarProps {
  activeTab: MainTab;
  onChange: (tab: MainTab) => void;
  consoleErrorCount: number;
  networkErrorCount: number;
}

function TabBar({ activeTab, onChange, consoleErrorCount, networkErrorCount }: TabBarProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const currentIdx = MAIN_TABS.findIndex((t) => t.id === activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (currentIdx + 1) % MAIN_TABS.length;
      onChange(MAIN_TABS[next]!.id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (currentIdx - 1 + MAIN_TABS.length) % MAIN_TABS.length;
      onChange(MAIN_TABS[prev]!.id);
      tabRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(MAIN_TABS[0]!.id);
      tabRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = MAIN_TABS.length - 1;
      onChange(MAIN_TABS[last]!.id);
      tabRefs.current[last]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Attempt details tabs"
      className="flex border-b border-border"
      onKeyDown={handleKeyDown}
    >
      {MAIN_TABS.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const badge =
          tab.id === 'console' && consoleErrorCount > 0
            ? consoleErrorCount
            : tab.id === 'network' && networkErrorCount > 0
            ? networkErrorCount
            : null;

        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[idx] = el; }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset
              ${isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {tab.label}
            {badge !== null && (
              <span
                className="inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold min-w-[16px] h-4 px-1"
                aria-label={`${badge} errors`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AttemptPage({ params }: Props) {
  const { slug, runId, attemptId } = use(params);
  const [activeTab, setActiveTab] = useState<MainTab>('console');

  const { data: attempt, isLoading, isError } = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => apiClient.getAttempt(attemptId),
  });

  const { data: runTest } = useQuery({
    queryKey: ['run-test', attempt?.runTestId],
    queryFn: () => apiClient.getRunTest(attempt!.runTestId),
    enabled: !!attempt?.runTestId,
  });

  // Set console tab active if there are errors to surface them
  useEffect(() => {
    if (attempt && attempt.consoleErrorCount > 0) {
      setActiveTab('console');
    }
  }, [attempt]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !attempt) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">Failed to load attempt. Please refresh.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const screenshots = (attempt.artifacts ?? []).filter((a) => a.type === 'SCREENSHOT');
  const videoArtifact = (attempt.artifacts ?? []).find((a) => a.type === 'VIDEO');
  const traceArtifact = (attempt.artifacts ?? []).find((a) => a.type === 'TRACE');
  const consoleLogArtifact = (attempt.artifacts ?? []).find((a) => a.type === 'CONSOLE_LOG');
  const networkLogArtifact = (attempt.artifacts ?? []).find((a) => a.type === 'NETWORK_LOG');

  const hasError = attempt.errorName || attempt.errorMessage || attempt.errorSnippet;
  const hasExpectedActual = attempt.expectedText != null || attempt.actualText != null;
  const totalAttempts = runTest?.attemptCount ?? null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href={`/projects/${slug}`} className="hover:underline focus-visible:underline">
          {slug}
        </Link>
        {' / '}
        <Link href={`/projects/${slug}/runs`} className="hover:underline focus-visible:underline">
          Runs
        </Link>
        {' / '}
        <Link
          href={`/projects/${slug}/runs/${runId}`}
          className="hover:underline focus-visible:underline font-mono"
        >
          {runId.slice(-12)}
        </Link>
        {' / '}
        <span className="text-foreground">Attempt {attempt.index + 1}</span>
      </nav>

      {/* ── Header ── */}
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={attempt.status} />
          {runTest?.browser && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-sm text-muted-foreground font-medium">
              <MonitorIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {runTest.browser}
            </span>
          )}
          <span className="text-sm text-muted-foreground font-mono">
            {formatDuration(attempt.durationMs)}
          </span>
          {totalAttempts !== null && totalAttempts > 1 && (
            <span className="text-sm text-muted-foreground">
              Attempt {attempt.index + 1} of {totalAttempts}
            </span>
          )}
        </div>
        {runTest?.testName && (
          <h1 className="text-lg font-semibold">{runTest.testName}</h1>
        )}
        {attempt.finalUrl && (
          <p className="text-sm text-muted-foreground">
            Final URL:{' '}
            <a
              href={attempt.finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4 hover:no-underline focus-visible:underline"
            >
              {attempt.finalUrl}
            </a>
          </p>
        )}
      </header>

      {/* ── AI triage — only for failed/timed-out attempts ── */}
      {(attempt.status === 'FAILED' || attempt.status === 'TIMED_OUT') && (
        <TriageCard attemptId={attemptId} />
      )}

      {/* ── Error card ── */}
      {hasError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive font-bold">
              {attempt.errorName ?? 'Error'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {attempt.errorMessage && (
              <pre className="text-sm font-mono whitespace-pre-wrap break-all text-destructive/90">
                {attempt.errorMessage}
              </pre>
            )}

            {hasExpectedActual && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Expected vs Actual</p>
                <MonacoDiffEditor
                  height="200px"
                  language="text"
                  original={attempt.expectedText ?? ''}
                  modified={attempt.actualText ?? ''}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    renderSideBySide: true,
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                  }}
                />
              </div>
            )}

            {attempt.errorSnippet && !hasExpectedActual && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Code frame</p>
                <pre className="text-xs font-mono bg-[#1e1e1e] text-[#d4d4d4] rounded-md p-3 overflow-x-auto whitespace-pre">
                  {attempt.errorSnippet}
                </pre>
              </div>
            )}

            {attempt.errorStack && (
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                  Stack trace
                </summary>
                <pre className="mt-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {attempt.errorStack}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step timeline ── */}
      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-sm font-semibold mb-3">
          Steps
        </h2>
        {attempt.steps && attempt.steps.length > 0 ? (
          <Card>
            <CardContent className="px-0 py-0 overflow-hidden">
              <StepTimeline steps={attempt.steps} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No steps recorded.</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Artifacts ── */}
      {(screenshots.length > 0 || videoArtifact || traceArtifact) && (
        <section aria-labelledby="artifacts-heading">
          <h2 id="artifacts-heading" className="text-sm font-semibold mb-3">
            Artifacts
          </h2>
          <Card>
            <CardContent className="pt-4 space-y-5">
              {/* Screenshots gallery */}
              {screenshots.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Screenshots ({screenshots.length})
                  </p>
                  <ScreenshotGallery artifacts={screenshots} />
                </div>
              )}

              {/* Video player */}
              {videoArtifact && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Video
                  </p>
                  <ArtifactVideo
                    artifactId={videoArtifact.id}
                    filename={videoArtifact.filename}
                  />
                </div>
              )}

              {/* Trace */}
              <div className="flex items-center gap-2">
                <VideoIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <OpenTrace traceArtifactId={traceArtifact?.id} />
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* No artifacts placeholder */}
      {screenshots.length === 0 && !videoArtifact && !traceArtifact && (
        <section aria-labelledby="artifacts-empty-heading">
          <h2 id="artifacts-empty-heading" className="text-sm font-semibold mb-3">Artifacts</h2>
          <Card>
            <CardContent className="flex flex-col items-center py-10 gap-2">
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No artifacts for this attempt.</p>
              <OpenTrace traceArtifactId={undefined} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Tabs: Console / Network / Stdout / Stderr ── */}
      <section aria-label="Attempt output tabs">
        <Card className="overflow-hidden">
          <TabBar
            activeTab={activeTab}
            onChange={setActiveTab}
            consoleErrorCount={attempt.consoleErrorCount ?? 0}
            networkErrorCount={attempt.networkErrorCount ?? 0}
          />

          {/* Console */}
          <div
            role="tabpanel"
            id="tabpanel-console"
            aria-labelledby="tab-console"
            hidden={activeTab !== 'console'}
            className="p-4"
          >
            {consoleLogArtifact ? (
              <ConsoleLogViewer artifact={consoleLogArtifact} />
            ) : (
              <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                <TerminalIcon className="h-7 w-7 opacity-30" aria-hidden="true" />
                <p className="text-sm">No console log artifact.</p>
              </div>
            )}
          </div>

          {/* Network */}
          <div
            role="tabpanel"
            id="tabpanel-network"
            aria-labelledby="tab-network"
            hidden={activeTab !== 'network'}
            className="p-4"
          >
            {networkLogArtifact ? (
              <NetworkLogViewer artifact={networkLogArtifact} />
            ) : (
              <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                <GlobeIcon className="h-7 w-7 opacity-30" aria-hidden="true" />
                <p className="text-sm">No network log artifact.</p>
              </div>
            )}
          </div>

          {/* Stdout */}
          <div
            role="tabpanel"
            id="tabpanel-stdout"
            aria-labelledby="tab-stdout"
            hidden={activeTab !== 'stdout'}
            className="p-4"
          >
            {attempt.stdout ? (
              <pre className="text-xs font-mono bg-[#0d1117] text-[#e6edf3] rounded-md p-4 overflow-x-auto whitespace-pre max-h-80 overflow-y-auto">
                {attempt.stdout}
              </pre>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">(empty)</p>
            )}
          </div>

          {/* Stderr */}
          <div
            role="tabpanel"
            id="tabpanel-stderr"
            aria-labelledby="tab-stderr"
            hidden={activeTab !== 'stderr'}
            className="p-4"
          >
            {attempt.stderr ? (
              <pre className="text-xs font-mono bg-[#0d1117] text-[#e6edf3] rounded-md p-4 overflow-x-auto whitespace-pre max-h-80 overflow-y-auto">
                {attempt.stderr}
              </pre>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">(empty)</p>
            )}
          </div>
        </Card>
      </section>

    </div>
  );
}
