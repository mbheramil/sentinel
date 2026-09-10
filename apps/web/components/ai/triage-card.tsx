'use client';

import { useState } from 'react';
import { SparklesIcon, Loader2Icon, InfoIcon, ShieldAlertIcon } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient, type TriageResponse, SentinelApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── Confidence badge colour mapping ──────────────────────────────────────────

function confidenceClass(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
    case 'medium':
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800';
    case 'low':
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700';
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TriageCardProps {
  attemptId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TriageCard({ attemptId }: TriageCardProps) {
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const triageMutation = useMutation({
    mutationFn: () => apiClient.triageAttempt(attemptId),
    onSuccess: (data) => {
      setResult(data);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(
        err instanceof SentinelApiError ? err.message : 'AI analysis failed. Please try again.',
      );
    },
  });

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <SparklesIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            AI Analysis
          </CardTitle>
          <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
            Powered by Claude
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Idle state */}
        {!result && !triageMutation.isPending && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Let Claude analyse the failure and suggest a likely cause.
            </p>
            {errorMsg && (
              <p role="alert" className="text-sm text-destructive">
                {errorMsg}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => triageMutation.mutate()}
              className="gap-2"
            >
              <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Analyse failure
            </Button>
          </div>
        )}

        {/* Loading state */}
        {triageMutation.isPending && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            Analysing failure...
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Cache indicator */}
            {result.fromCache && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <InfoIcon className="h-3 w-3" aria-hidden="true" />
                Result from cache
              </div>
            )}

            {/* Likely cause */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Likely cause
                </p>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-medium px-1.5 py-0 h-auto ${confidenceClass(result.confidence)}`}
                >
                  {result.confidence} confidence
                </Badge>
              </div>
              <p className="text-sm">{result.likelyCause}</p>
            </div>

            {/* Suggestion */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Suggestion
              </p>
              <p className="text-sm">{result.suggestion}</p>
            </div>

            {/* Re-analyse button + disclaimer */}
            <div className="flex items-start justify-between gap-4 pt-1 border-t border-border">
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldAlertIcon className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{result.disclaimer}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-auto py-0.5 px-2 shrink-0"
                onClick={() => {
                  setResult(null);
                  triageMutation.mutate();
                }}
                disabled={triageMutation.isPending}
                aria-label="Re-run AI analysis"
              >
                Re-analyse
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
