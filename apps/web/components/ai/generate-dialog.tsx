'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Loader2Icon,
  SparklesIcon,
  XIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient, type GenerateTestResponse, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Monaco DiffEditor — lazy-loaded, SSR disabled
const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 rounded-md bg-muted animate-pulse" aria-label="Loading editor" />
    ),
  },
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user clicks "Save as draft" with the generated code + IR */
  onSave: (result: GenerateTestResponse) => void;
  /** Existing code in the editor (shown as left side of diff) */
  existingCode?: string;
}

// ── Step kind → human label ───────────────────────────────────────────────────

function stepLabel(step: Record<string, unknown>): string {
  const kind = step['kind'] as string | undefined;
  switch (kind) {
    case 'goto': return `Navigate to ${String(step['url'] ?? '')}`;
    case 'click': return `Click element`;
    case 'fill': return `Fill field`;
    case 'type': return `Type text`;
    case 'press': return `Press key "${String(step['key'] ?? '')}"`;
    case 'select': return `Select option`;
    case 'check': return `${step['checked'] ? 'Check' : 'Uncheck'} checkbox`;
    case 'hover': return `Hover element`;
    case 'scrollTo': return `Scroll to element`;
    case 'waitFor': return `Wait for element to be ${String(step['state'] ?? 'visible')}`;
    case 'expect': return `Assert condition`;
    case 'screenshot': return `Take screenshot "${String(step['name'] ?? '')}"`;
    case 'group': return `Group: ${String(step['title'] ?? '')}`;
    case 'comment': return `// ${String(step['text'] ?? '')}`;
    case 'apiRequest': return `API ${String(step['method'] ?? 'GET')} ${String(step['url'] ?? '')}`;
    default: return kind ? `${kind} step` : 'Unknown step';
  }
}

// ── Step preview list ─────────────────────────────────────────────────────────

function StepList({ ir }: { ir: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (!ir || typeof ir !== 'object' || !('steps' in ir)) return null;
  const steps = (ir as { steps: unknown[] }).steps;
  if (!Array.isArray(steps)) return null;

  const visible = expanded ? steps : steps.slice(0, 5);
  const hasMore = steps.length > 5;

  return (
    <div className="rounded-md border border-border bg-muted/30 text-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/50">
        <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
          Generated steps ({steps.length})
        </span>
      </div>
      <ol className="divide-y divide-border/50">
        {visible.map((step, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2">
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-5 mt-0.5 text-right">
              {i + 1}
            </span>
            <span className="text-xs font-mono text-foreground/80 break-all">
              {stepLabel(step as Record<string, unknown>)}
            </span>
          </li>
        ))}
      </ol>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="h-3 w-3" aria-hidden="true" />
              Show fewer
            </>
          ) : (
            <>
              <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
              Show {steps.length - 5} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function GenerateDialog({ open, onClose, onSave, existingCode = '' }: GenerateDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');
  const [deepMode, setDeepMode] = useState(false);
  const [result, setResult] = useState<GenerateTestResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.generateTest({
        prompt,
        url: url.trim() || undefined,
        deepMode,
      }),
    onSuccess: (data) => {
      setResult(data);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err instanceof SentinelApiError ? err.message : 'Generation failed. Please try again.');
    },
  });

  const handleClose = useCallback(() => {
    setPrompt('');
    setUrl('');
    setDeepMode(false);
    setResult(null);
    setErrorMsg(null);
    onClose();
  }, [onClose]);

  const handleSave = useCallback(() => {
    if (result) {
      onSave(result);
      handleClose();
    }
  }, [result, onSave, handleClose]);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setErrorMsg(null);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-background border border-border shadow-2xl p-6 space-y-5 focus:outline-none"
          aria-describedby="generate-dialog-desc"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-primary" aria-hidden="true" />
              <Dialog.Title className="text-lg font-semibold">Generate test with AI</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close dialog"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* Warning banner */}
          <div
            role="note"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p id="generate-dialog-desc">
              AI-generated tests should be reviewed before running in production.
            </p>
          </div>

          {/* Form (hidden once result is shown) */}
          {!result && (
            <div className="space-y-4">
              {/* Prompt */}
              <div className="space-y-1.5">
                <Label htmlFor="gen-prompt">What should this test do?</Label>
                <textarea
                  id="gen-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder='Log in as the demo user and verify the dashboard greeting'
                  rows={4}
                  disabled={generateMutation.isPending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
                />
              </div>

              {/* URL */}
              <div className="space-y-1.5">
                <Label htmlFor="gen-url">
                  URL to analyse accessibility tree{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="gen-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://app.example.com/login"
                  disabled={generateMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Sentinel will fetch the page and provide its element tree to the AI.
                </p>
              </div>

              {/* Deep mode toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={deepMode}
                  onClick={() => setDeepMode((prev) => !prev)}
                  disabled={generateMutation.isPending}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50
                    ${deepMode ? 'bg-primary' : 'bg-input'}`}
                  aria-label="Enable deep mode"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${deepMode ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
                <div>
                  <p className="text-sm font-medium">Deep mode</p>
                  <p className="text-xs text-muted-foreground">
                    Uses a more powerful model — slower and costs more tokens.
                  </p>
                </div>
              </div>

              {/* Error */}
              {errorMsg && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMsg}
                </p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleClose} disabled={generateMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={!prompt.trim() || generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      Generate
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Result view */}
          {result && (
            <div className="space-y-4">
              {/* Explanation */}
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2Icon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p>{result.explanation}</p>
              </div>

              {/* Token info */}
              <p className="text-xs text-muted-foreground">
                Model: <span className="font-mono">{result.model}</span> —{' '}
                {result.inputTokens.toLocaleString()} input tokens,{' '}
                {result.outputTokens.toLocaleString()} output tokens
              </p>

              {/* Step list preview */}
              <StepList ir={result.stepsIr} />

              {/* Diff view */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Code diff (left: current, right: generated)
                </p>
                <div className="rounded-md overflow-hidden border border-border">
                  <MonacoDiffEditor
                    height="320px"
                    language="typescript"
                    original={existingCode}
                    modified={result.code}
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
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <Button variant="outline" size="sm" onClick={handleDiscard}>
                  Discard — try again
                </Button>
                <Button size="sm" onClick={handleSave}>
                  <SaveIconInline />
                  Save as draft
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Inline save icon to avoid import collision with named Save from lucide
function SaveIconInline() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
