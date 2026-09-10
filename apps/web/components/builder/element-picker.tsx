'use client';

import { useState, useRef } from 'react';
import { MousePointerClickIcon, InfoIcon, XIcon, CheckIcon } from 'lucide-react';
import type { Target } from './ir-types';
import { Button } from '@/components/ui/button';

interface LocatorSuggestion {
  by: Target['by'];
  label: string;
  preview: string;
  isFragile: boolean;
}

interface Props {
  baseUrl?: string;
  onInsert: (target: Target) => void;
}

const CROSS_ORIGIN_NOTE =
  'The element picker works best when the target site is same-origin or served through a proxy. Cross-origin pages block script injection due to browser security policies — locator suggestions below are illustrative only.';

const DEMO_SUGGESTIONS: LocatorSuggestion[] = [
  {
    by: 'role',
    label: 'getByRole',
    preview: "page.getByRole('button', { name: 'Submit' })",
    isFragile: false,
  },
  {
    by: 'label',
    label: 'getByLabel',
    preview: "page.getByLabel('Email address')",
    isFragile: false,
  },
  {
    by: 'testId',
    label: 'getByTestId',
    preview: "page.getByTestId('submit-btn')",
    isFragile: false,
  },
  {
    by: 'css',
    label: 'CSS selector',
    preview: "page.locator('#submit-btn')",
    isFragile: true,
  },
];

function suggestionToTarget(s: LocatorSuggestion): Target {
  switch (s.by) {
    case 'role':
      return { by: 'role', role: 'button', name: 'Submit' };
    case 'label':
      return { by: 'label', value: 'Email address' };
    case 'testId':
      return { by: 'testId', value: 'submit-btn' };
    case 'css':
      return { by: 'css', value: '#submit-btn' };
    default:
      return { by: 'role', role: '' };
  }
}

export function ElementPicker({ baseUrl, onInsert }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState(baseUrl ?? '');
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [insertedIdx, setInsertedIdx] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function handleOpen() {
    setIsOpen(true);
    setFrameLoaded(false);
    setFrameError(false);
    setInsertedIdx(null);
  }

  function handleClose() {
    setIsOpen(false);
    setFrameLoaded(false);
    setFrameError(false);
    setInsertedIdx(null);
  }

  function handleUse(suggestion: LocatorSuggestion, idx: number) {
    onInsert(suggestionToTarget(suggestion));
    setInsertedIdx(idx);
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleOpen}
        aria-label="Open element picker"
      >
        <MousePointerClickIcon className="h-3.5 w-3.5" aria-hidden="true" />
        Pick element
      </Button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-stretch"
          role="dialog"
          aria-modal="true"
          aria-label="Element picker"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={handleClose}
          />

          {/* Panel */}
          <div className="relative ml-auto flex flex-col w-full max-w-4xl bg-background border-l border-border shadow-xl z-10">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              <MousePointerClickIcon
                className="h-4 w-4 text-primary"
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold flex-1">Element Picker</h2>
              <button
                type="button"
                className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={handleClose}
                aria-label="Close element picker"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* URL bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-muted/30">
              <input
                type="url"
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={baseUrl ?? 'https://example.com'}
                aria-label="Page URL to open"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setFrameLoaded(false);
                    setFrameError(false);
                    if (iframeRef.current) {
                      iframeRef.current.src = url;
                    }
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setFrameLoaded(false);
                  setFrameError(false);
                }}
                aria-label="Load URL in preview"
              >
                Load
              </Button>
            </div>

            {/* Cross-origin notice */}
            <div className="flex items-start gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400 shrink-0">
              <InfoIcon
                className="h-3.5 w-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              {CROSS_ORIGIN_NOTE}
            </div>

            <div className="flex flex-1 min-h-0">
              {/* iFrame preview */}
              <div className="flex-1 relative bg-muted/20">
                {url ? (
                  <>
                    {!frameLoaded && !frameError && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-xs text-muted-foreground">
                          Loading preview…
                        </p>
                      </div>
                    )}
                    {frameError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8">
                        <InfoIcon
                          className="h-8 w-8 text-muted-foreground/40"
                          aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground text-center">
                          Preview unavailable. The page may have blocked
                          embedding (X-Frame-Options or CSP).
                        </p>
                        <p className="text-xs text-muted-foreground text-center">
                          Use the locator suggestions on the right to manually
                          select a locator.
                        </p>
                      </div>
                    )}
                    <iframe
                      ref={iframeRef}
                      src={url}
                      className="w-full h-full border-none"
                      title="Page preview"
                      sandbox="allow-same-origin allow-scripts allow-forms"
                      onLoad={() => setFrameLoaded(true)}
                      onError={() => setFrameError(true)}
                      aria-label="Site preview for element picking"
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <MousePointerClickIcon
                      className="h-10 w-10 text-muted-foreground/30"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-muted-foreground">
                      Enter a URL above to preview your site
                    </p>
                  </div>
                )}
              </div>

              {/* Locator suggestions panel */}
              <div className="w-72 shrink-0 border-l border-border flex flex-col">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium">Locator suggestions</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Click an element in the preview (if not blocked) or choose a
                    suggestion below
                  </p>
                </div>

                <ul className="flex-1 overflow-y-auto divide-y divide-border">
                  {DEMO_SUGGESTIONS.map((s, i) => (
                    <li key={i}>
                      <div className="px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {s.label}
                          </span>
                          {s.isFragile && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">
                              fragile
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-foreground/80 break-all leading-snug">
                          {s.preview}
                        </p>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          onClick={() => handleUse(s, i)}
                          aria-label={`Use ${s.label} locator`}
                        >
                          {insertedIdx === i ? (
                            <>
                              <CheckIcon
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              Inserted
                            </>
                          ) : (
                            'Use this locator'
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
