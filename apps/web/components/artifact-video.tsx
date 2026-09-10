'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2Icon, AlertCircleIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface ArtifactVideoProps {
  artifactId: string;
  filename?: string;
}

export function ArtifactVideo({ artifactId, filename }: ArtifactVideoProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['artifact-url', artifactId],
    queryFn: () => apiClient.getArtifactUrl(artifactId),
    // Presigned URLs are typically valid ~5–15 minutes; refetch before expiry
    staleTime: 4 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2Icon className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading video…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center py-12 gap-2 text-destructive"
      >
        <AlertCircleIcon className="h-7 w-7" aria-hidden="true" />
        <p className="text-sm">Failed to load video.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filename && (
        <p className="text-xs text-muted-foreground font-mono" aria-label={`Filename: ${filename}`}>
          {filename}
        </p>
      )}
      <video
        controls
        src={data.url}
        className="w-full rounded-md bg-black max-h-[60vh]"
        aria-label={filename ? `Video recording: ${filename}` : 'Test run video recording'}
      >
        {/* Fallback for browsers that do not support HTML5 video */}
        <p className="p-4 text-sm text-muted-foreground">
          Your browser does not support HTML5 video.{' '}
          <a href={data.url} download={filename} className="text-primary underline">
            Download the video
          </a>
          .
        </p>
      </video>
    </div>
  );
}
