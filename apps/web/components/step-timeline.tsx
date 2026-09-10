'use client';

import { useState, useMemo } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-react';
import type { StepResultResponse } from '@/lib/api-client';

// ── Colour helpers ────────────────────────────────────────────────────────────

function barColorClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'passed') return 'bg-emerald-500';
  if (s === 'failed') return 'bg-rose-500';
  if (s === 'flaky') return 'bg-amber-400';
  if (s === 'skipped') return 'bg-slate-400';
  return 'bg-slate-400';
}

function dotColorClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'passed') return 'bg-emerald-500';
  if (s === 'failed') return 'bg-rose-500';
  if (s === 'flaky') return 'bg-amber-400';
  if (s === 'skipped') return 'bg-slate-400';
  return 'bg-slate-400';
}

function categoryChipClass(category: string): string {
  switch (category) {
    case 'hook':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400';
    case 'expect':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
    case 'pw:api':
      return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400';
    case 'test.step':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function httpStatusClass(code: number): string {
  if (code < 300) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
  if (code < 400) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
  return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400';
}

// ── Start-time computation ────────────────────────────────────────────────────

function computeStartTimes(steps: StepResultResponse[]): Map<string, number> {
  const startTimes = new Map<string, number>();
  const byParent = new Map<string | null, StepResultResponse[]>();

  for (const step of steps) {
    const arr = byParent.get(step.parentId) ?? [];
    arr.push(step);
    byParent.set(step.parentId, arr);
  }

  function assignTimes(parentId: string | null, parentStart: number): void {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position);
    let t = parentStart;
    for (const child of children) {
      startTimes.set(child.id, t);
      assignTimes(child.id, t);
      t += child.durationMs ?? 0;
    }
  }

  assignTimes(null, 0);
  return startTimes;
}

// ── Tooltip types ─────────────────────────────────────────────────────────────

interface TooltipState {
  step: StepResultResponse;
  x: number;
  y: number;
}

// ── Main component ────────────────────────────────────────────────────────────

interface StepTimelineProps {
  steps: StepResultResponse[];
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const hasChildren = new Set(steps.map((s) => s.parentId).filter(Boolean) as string[]);
    return new Set(steps.filter((s) => hasChildren.has(s.id)).map((s) => s.id));
  });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const startTimes = useMemo(() => computeStartTimes(steps), [steps]);

  const totalMs = useMemo(() => {
    let max = 0;
    for (const step of steps) {
      const start = startTimes.get(step.id) ?? 0;
      const end = start + (step.durationMs ?? 0);
      if (end > max) max = end;
    }
    return max > 0 ? max : 1;
  }, [steps, startTimes]);

  const byParent = useMemo(() => {
    const m = new Map<string | null, StepResultResponse[]>();
    for (const step of steps) {
      const arr = m.get(step.parentId) ?? [];
      arr.push(step);
      m.set(step.parentId, arr);
    }
    return m;
  }, [steps]);

  function toggleExpand(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatDur(ms: number | null): string {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function renderStep(step: StepResultResponse): React.ReactNode {
    const children = (byParent.get(step.id) ?? []).sort((a, b) => a.position - b.position);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(step.id);
    const startMs = startTimes.get(step.id) ?? 0;
    const durMs = step.durationMs ?? 0;
    const leftPct = (startMs / totalMs) * 100;
    const widthPct = Math.max((durMs / totalMs) * 100, 0.3);

    return (
      <div key={step.id}>
        <div
          className="flex items-center border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
          style={{ paddingLeft: `${step.depth * 16 + 4}px` }}
        >
          {/* Label column: 40% */}
          <div className="flex items-center gap-1.5 py-1.5 pr-2 min-w-0" style={{ width: '40%' }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleExpand(step.id)}
                className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse step group' : 'Expand step group'}
              >
                {isExpanded ? (
                  <ChevronDownIcon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRightIcon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}

            <span
              className={`inline-block h-2 w-2 rounded-sm shrink-0 ${dotColorClass(step.status)}`}
              aria-hidden="true"
            />

            <span className="text-xs truncate flex-1 min-w-0" title={step.title}>
              {step.title}
            </span>

            <span
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ml-1 ${categoryChipClass(step.category)}`}
            >
              {step.category}
            </span>
          </div>

          {/* Timeline track column: flex-1 */}
          <div className="relative flex-1 h-7 flex items-center">
            {/* Track background */}
            <div className="absolute inset-y-1.5 inset-x-0 rounded-sm bg-muted/40" />

            {/* Gantt bar */}
            <div
              className={`absolute h-4 rounded-sm opacity-90 cursor-default transition-opacity hover:opacity-100 ${barColorClass(step.status)}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              onMouseEnter={(e) => {
                setTooltip({ step, x: e.clientX, y: e.clientY });
              }}
              onMouseLeave={() => setTooltip(null)}
              aria-hidden="true"
            />

            {/* HTTP status badge (for goto steps) */}
            {step.httpStatus != null && (
              <span
                className={`absolute text-[10px] font-mono px-1 rounded leading-4 ${httpStatusClass(step.httpStatus)}`}
                style={{ left: `calc(${leftPct + widthPct}% + 3px)` }}
              >
                {step.httpStatus}
              </span>
            )}

            {/* Duration label */}
            <span className="absolute right-1.5 text-[10px] text-muted-foreground font-mono pointer-events-none">
              {formatDur(step.durationMs)}
            </span>
          </div>
        </div>

        {isExpanded && children.map((child) => renderStep(child))}
      </div>
    );
  }

  const roots = (byParent.get(null) ?? []).sort((a, b) => a.position - b.position);

  return (
    <>
      <div className="divide-y-0" aria-label="Step timeline">
        {roots.map((root) => renderStep(root))}
      </div>

      {/* Floating tooltip — fixed to viewport so it works inside any scroll container */}
      {tooltip && (
        <div
          role="tooltip"
          className="fixed z-50 bg-card border border-border rounded-md shadow-lg p-3 text-xs pointer-events-none max-w-xs"
          style={{ left: tooltip.x + 14, top: tooltip.y + 10 }}
        >
          <p className="font-semibold mb-1.5 break-words text-foreground">{tooltip.step.title}</p>
          {tooltip.step.selector && (
            <p className="text-muted-foreground font-mono truncate mb-0.5">
              <span className="text-foreground">selector:</span> {tooltip.step.selector}
            </p>
          )}
          <p className="text-muted-foreground mb-0.5">
            <span className="text-foreground">duration:</span>{' '}
            {tooltip.step.durationMs != null ? `${tooltip.step.durationMs}ms` : '—'}
          </p>
          <p className="text-muted-foreground mb-0.5">
            <span className="text-foreground">category:</span> {tooltip.step.category}
          </p>
          {tooltip.step.httpStatus != null && (
            <p className="text-muted-foreground">
              <span className="text-foreground">HTTP:</span> {tooltip.step.httpStatus}
            </p>
          )}
          {tooltip.step.errorMessage && (
            <p className="mt-1.5 text-rose-600 dark:text-rose-400 font-mono break-words">
              {tooltip.step.errorMessage}
            </p>
          )}
        </div>
      )}
    </>
  );
}
