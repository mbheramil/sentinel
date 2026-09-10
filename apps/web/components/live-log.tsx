'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { SSE_LIVE_DEBOUNCE_MS } from '@sentinel/shared';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
const MAX_LINES = 5000;

interface LogLine {
  id: number;
  ts: string;
  text: string;
  level?: 'info' | 'error' | 'warn';
}

function formatEvent(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'run.begin':
      return `▶  Run started — ${p['totalTests']} test${Number(p['totalTests']) === 1 ? '' : 's'}, ${p['workers']} worker (Playwright ${p['playwrightVersion']})`;
    case 'run.end':
      return `■  Run finished — ${p['status']}  (${p['durationMs']}ms)`;
    case 'test.begin':
      return `  ○ ${p['title'] ?? p['testId']}  [${p['projectLabel']}]${Number(p['attemptIndex']) > 0 ? `  retry #${p['attemptIndex']}` : ''}`;
    case 'test.end': {
      const ok = p['status'] === 'passed';
      const icon = ok ? '  ✓' : p['status'] === 'skipped' ? '  -' : '  ✗';
      const err = p['error'] ? `\n      ${(p['error'] as Record<string, unknown>)['message'] ?? p['error']}` : '';
      return `${icon} ${p['title'] ?? p['testId']}  (${p['durationMs']}ms)${err}`;
    }
    case 'step.begin':
      return `    → ${p['title']}`;
    case 'step.end': {
      if (p['status'] === 'failed' && p['error']) {
        return `    ✗ ${p['title']}  — ${p['error']}`;
      }
      return `    ✓ ${p['title']}  (${p['durationMs']}ms)`;
    }
    case 'test.stdout':
      return `    [stdout] ${String(p['chunk'] ?? '').trim()}`;
    case 'test.stderr':
      return `    [stderr] ${String(p['chunk'] ?? '').trim()}`;
    default:
      return `[${type}]`;
  }
}

function parseLogLevel(text: string): LogLine['level'] {
  if (text.startsWith('  ✗') || text.includes('[stderr]') || text.includes('error')) return 'error';
  if (text.startsWith('  ✓') || text.startsWith('▶') || text.startsWith('■')) return 'info';
  if (text.includes('[stdout]')) return 'warn';
  return 'info';
}

export interface LiveLogProps {
  runId: string;
  className?: string;
}

let lineCounter = 0;

export function LiveLog({ runId, className }: LiveLogProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<LogLine[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    setLines((prev) => {
      const next = [...prev, ...pendingRef.current];
      pendingRef.current = [];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const scheduledFlush = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPending();
    }, SSE_LIVE_DEBOUNCE_MS);
  }, [flushPending]);

  const appendLine = useCallback(
    (text: string, ts: string) => {
      pendingRef.current.push({ id: lineCounter++, ts, text, level: parseLogLevel(text) });
      scheduledFlush();
    },
    [scheduledFlush],
  );

  useEffect(() => {
    const es = new EventSource(`${BASE_URL}/runs/${runId}/events`);
    setConnected(false);

    es.addEventListener('open', () => setConnected(true));

    es.addEventListener('message', (e: MessageEvent<string>) => {
      try {
        const evt = JSON.parse(e.data) as {
          type: string;
          ts: string;
          payload?: Record<string, unknown>;
        };
        appendLine(formatEvent(evt.type, evt.payload ?? {}), evt.ts ?? new Date().toISOString());
      } catch {
        appendLine(e.data, new Date().toISOString());
      }
    });

    es.addEventListener('done', () => {
      flushPending();
      setEnded(true);
      es.close();
    });

    es.addEventListener('error', () => {
      setConnected(false);
    });

    return () => {
      es.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [runId, appendLine, flushPending]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  return (
    <div className={cn('flex flex-col rounded-md border border-border overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              ended ? 'bg-status-skipped' : connected ? 'bg-status-passed' : 'bg-status-flaky animate-pulse',
            )}
            aria-hidden="true"
          />
          <span className="text-xs text-muted-foreground">
            {ended ? 'Completed' : connected ? 'Live' : 'Connecting…'}
          </span>
          <span className="text-xs text-muted-foreground">{lines.length} lines</span>
        </div>
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          className={cn(
            'text-xs px-2 py-0.5 rounded border transition-colors',
            autoScroll
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
        </button>
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto bg-[#0d1117] text-[#e6edf3] font-mono text-xs leading-5"
        style={{ height: '480px' }}
        aria-label="Run log output"
        aria-live="polite"
        aria-atomic="false"
      >
        {lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {connected ? 'Waiting for output…' : 'Connecting to event stream…'}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className={cn(
                    'hover:bg-white/5',
                    line.level === 'error' && 'text-rose-400',
                    line.level === 'warn' && 'text-amber-400',
                  )}
                >
                  <td className="pl-3 pr-2 py-0 select-none text-slate-600 text-right w-12 shrink-0">
                    {String(line.id + 1).padStart(4, ' ')}
                  </td>
                  <td className="px-2 py-0 text-slate-500 whitespace-nowrap w-24 shrink-0">
                    {line.ts.slice(11, 23)}
                  </td>
                  <td className="px-2 py-0 pr-3 whitespace-pre-wrap break-all">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
