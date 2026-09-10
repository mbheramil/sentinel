'use client';

import { useQuery } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

interface OpenTraceProps {
  /** The artifact ID of the trace file. Pass null/undefined if no trace exists. */
  traceArtifactId: string | null | undefined;
}

export function OpenTrace({ traceArtifactId }: OpenTraceProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['artifact-url', traceArtifactId],
    queryFn: () => apiClient.getArtifactUrl(traceArtifactId!),
    enabled: !!traceArtifactId,
    staleTime: 4 * 60 * 1000,
  });

  function handleOpen(): void {
    if (!data) return;
    const traceViewerUrl = `/trace-viewer/?trace=${encodeURIComponent(data.url)}`;
    window.open(traceViewerUrl, '_blank', 'noopener,noreferrer');
  }

  // No trace artifact — show disabled button with tooltip
  if (!traceArtifactId) {
    return (
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            {/* Wrapping span allows Tooltip to attach to a disabled button */}
            <span tabIndex={0} className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                disabled
                aria-disabled="true"
                aria-describedby="no-trace-tooltip"
              >
                <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
                Open Trace
              </Button>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              id="no-trace-tooltip"
              className="bg-card border border-border rounded-md px-3 py-1.5 text-xs shadow-md z-50 max-w-xs"
              sideOffset={6}
              role="tooltip"
            >
              No trace artifact recorded for this attempt
              <Tooltip.Arrow className="fill-border" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleOpen}
      disabled={isLoading || !data}
      aria-label="Open Playwright trace viewer in new tab"
    >
      {isLoading ? (
        <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
      )}
      Open Trace
    </Button>
  );
}
