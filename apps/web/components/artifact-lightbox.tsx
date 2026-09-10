'use client';

import { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { XIcon, DownloadIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

export interface LightboxScreenshot {
  artifactId: string;
  url: string;
  filename: string;
}

interface ArtifactLightboxProps {
  screenshots: LightboxScreenshot[];
  /** null means closed */
  currentIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ArtifactLightbox({
  screenshots,
  currentIndex,
  onClose,
  onNavigate,
}: ArtifactLightboxProps) {
  const isOpen = currentIndex !== null;
  const current = currentIndex !== null ? screenshots[currentIndex] : null;
  const hasPrev = currentIndex !== null && currentIndex > 0;
  const hasNext = currentIndex !== null && currentIndex < screenshots.length - 1;

  // Arrow-key navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'ArrowLeft' && hasPrev && currentIndex !== null) {
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && hasNext && currentIndex !== null) {
        onNavigate(currentIndex + 1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasPrev, hasNext, currentIndex, onNavigate]);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85" />

        <Dialog.Content
          className="fixed inset-0 z-50 flex items-center justify-center focus:outline-none"
          aria-label={current ? `Screenshot: ${current.filename}` : 'Screenshot lightbox'}
        >
          {/* Visually hidden title for screen readers */}
          <Dialog.Title className="sr-only">
            {current ? `Screenshot: ${current.filename}` : 'Screenshot viewer'}
          </Dialog.Title>

          {/* Close */}
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
              aria-label="Close lightbox"
            >
              <XIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </Dialog.Close>

          {/* Download */}
          {current && (
            <a
              href={current.url}
              download={current.filename}
              className="absolute top-4 right-16 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
              aria-label={`Download ${current.filename}`}
            >
              <DownloadIcon className="h-5 w-5" aria-hidden="true" />
            </a>
          )}

          {/* Previous */}
          {hasPrev && (
            <button
              type="button"
              onClick={() => currentIndex !== null && onNavigate(currentIndex - 1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
              aria-label="Previous screenshot"
            >
              <ChevronLeftIcon className="h-6 w-6" aria-hidden="true" />
            </button>
          )}

          {/* Next */}
          {hasNext && (
            <button
              type="button"
              onClick={() => currentIndex !== null && onNavigate(currentIndex + 1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
              aria-label="Next screenshot"
            >
              <ChevronRightIcon className="h-6 w-6" aria-hidden="true" />
            </button>
          )}

          {/* Counter badge */}
          {screenshots.length > 1 && currentIndex !== null && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/60 rounded-full px-3 py-1 text-white text-sm font-medium">
              {currentIndex + 1} / {screenshots.length}
            </div>
          )}

          {/* Image */}
          {current && (
            <div className="relative max-w-full max-h-full flex flex-col items-center gap-3 p-16">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={current.filename}
                className="max-w-[90vw] max-h-[80vh] rounded-md object-contain shadow-2xl"
                draggable={false}
              />
              <span className="bg-black/60 rounded-md px-3 py-1 text-white text-xs font-mono">
                {current.filename}
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
