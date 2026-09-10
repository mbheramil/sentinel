'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { CheckCircleIcon, TrashIcon, ClockIcon, AlertCircleIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Baseline {
  id: string;
  testCaseId: string;
  name: string;
  browser: string;
  storageKey: string;
  thumbnailUrl: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Data fetching ────────────────────────────────────────────────────────────

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

async function fetchBaselines(testId: string): Promise<Baseline[]> {
  const res = await fetch(`${API_BASE}/tests/${testId}/baselines`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Baseline[]>;
}

async function approveBaseline(testId: string, baselineId: string): Promise<Baseline> {
  const res = await fetch(`${API_BASE}/tests/${testId}/baselines/${baselineId}/approve`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Baseline>;
}

async function deleteBaseline(testId: string, baselineId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tests/${testId}/baselines/${baselineId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
}

// ── Browser badge ─────────────────────────────────────────────────────────

const BROWSER_COLORS: Record<string, string> = {
  CHROMIUM: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  FIREFOX: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  WEBKIT: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

function BrowserBadge({ browser }: { browser: string }) {
  const classes = BROWSER_COLORS[browser] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {browser.charAt(0) + browser.slice(1).toLowerCase()}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function BaselinesPage() {
  const params = useParams<{ slug: string; testId: string }>();
  const { testId } = params;
  const qc = useQueryClient();

  const { data: baselines, isLoading, isError, error } = useQuery<Baseline[], Error>({
    queryKey: ['baselines', testId],
    queryFn: () => fetchBaselines(testId),
  });

  const approveMutation = useMutation({
    mutationFn: (baselineId: string) => approveBaseline(testId, baselineId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['baselines', testId] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (baselineId: string) => deleteBaseline(testId, baselineId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['baselines', testId] }); },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <ClockIcon className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
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
        <span>{error?.message ?? 'Failed to load baselines'}</span>
      </div>
    );
  }

  const items = baselines ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Visual Baselines</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Screenshot baselines for visual regression testing.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">
            No baselines yet. Run a test with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">toHaveScreenshot()</code> to
            capture your first baseline.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {items.map((baseline) => (
            <li
              key={baseline.id}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted">
                {baseline.thumbnailUrl ? (
                  <Image
                    src={baseline.thumbnailUrl}
                    alt={`${baseline.name} screenshot baseline`}
                    fill
                    className="object-contain"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No preview
                  </div>
                )}

                {/* Pending review badge */}
                {!baseline.approvedAt && (
                  <span className="absolute right-2 top-2 rounded-full bg-yellow-500 px-2 py-0.5 text-xs font-medium text-white">
                    Pending review
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="flex-1 truncate text-sm font-medium text-foreground"
                    title={baseline.name}
                  >
                    {baseline.name}
                  </p>
                  <BrowserBadge browser={baseline.browser} />
                </div>

                {baseline.approvedAt && (
                  <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Approved
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 border-t border-border p-3">
                {!baseline.approvedAt && (
                  <button
                    type="button"
                    onClick={() => { approveMutation.mutate(baseline.id); }}
                    disabled={approveMutation.isPending}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    aria-label={`Approve baseline ${baseline.name}`}
                  >
                    <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Approve
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { deleteMutation.mutate(baseline.id); }}
                  disabled={deleteMutation.isPending}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label={`Delete baseline ${baseline.name}`}
                >
                  <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
