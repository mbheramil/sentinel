'use client';

import { useState } from 'react';
import {
  GripVerticalIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  TrashIcon,
  AlertTriangleIcon,
} from 'lucide-react';
import type { Step } from './ir-types';
import {
  STEP_KIND_META,
  hasFragileTarget,
  summarizeStep,
} from './ir-types';
import { cn } from '@/lib/utils';

interface Props {
  step: Step;
  index: number;
  isSelected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onChange: (next: Step) => void;
  /** Drag event handlers forwarded from StepList */
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function StepCard({
  step,
  index,
  isSelected,
  isDragging,
  isDragOver,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = STEP_KIND_META[step.kind];
  const isFragile = hasFragileTarget(step);
  const summary = summarizeStep(step);

  return (
    <div
      className={cn(
        'rounded-lg border transition-colors select-none',
        isSelected
          ? 'border-ring bg-accent/30'
          : 'border-border bg-card hover:border-ring/50',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
      )}
      role="article"
      aria-label={`Step ${index + 1}: ${step.kind} — ${summary}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drop indicator */}
      {isDragOver && (
        <div
          className="h-0.5 w-full bg-primary rounded-full -mt-px"
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Drag handle */}
        <div
          className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-muted-foreground shrink-0 touch-none"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-grabbed={isDragging}
          aria-label="Drag to reorder"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
            }
          }}
        >
          <GripVerticalIcon className="h-4 w-4" aria-hidden="true" />
        </div>

        {/* Kind badge */}
        <span
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0',
            meta.color,
          )}
          aria-label={`Step kind: ${meta.label}`}
        >
          {meta.label}
        </span>

        {/* Summary — click to select */}
        <button
          type="button"
          className="flex-1 min-w-0 text-left text-xs text-foreground/90 truncate hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
          onClick={onSelect}
          aria-current={isSelected}
        >
          {summary}
        </button>

        {/* Fragile warning */}
        {isFragile && (
          <AlertTriangleIcon
            className="h-3.5 w-3.5 shrink-0 text-amber-500"
            aria-label="Uses CSS/XPath selector — consider a more resilient locator"
          />
        )}

        {/* Expand/collapse */}
        <button
          type="button"
          className="shrink-0 text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-0.5"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse step' : 'Expand step'}
        >
          {expanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        {/* Delete */}
        <button
          type="button"
          className="shrink-0 text-muted-foreground/60 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-0.5"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete step ${index + 1}`}
        >
          <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Expanded content — quick field view */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 bg-muted/20 rounded-b-lg">
          <StepQuickFields step={step} />
        </div>
      )}
    </div>
  );
}

/** Compact read-only field display when a card is expanded inline */
function StepQuickFields({ step }: { step: Step }) {
  function row(key: string, value: string) {
    return (
      <div key={key} className="flex gap-2 text-xs leading-5">
        <span className="text-muted-foreground w-20 shrink-0">{key}</span>
        <span className="font-mono text-foreground/90 truncate">{value}</span>
      </div>
    );
  }

  switch (step.kind) {
    case 'goto':
      return (
        <div className="space-y-0.5">
          {row('url', step.url)}
          {step.waitUntil && row('waitUntil', step.waitUntil)}
          {step.expectStatus !== undefined &&
            row('expectStatus', String(step.expectStatus))}
        </div>
      );
    case 'click':
      return (
        <div className="space-y-0.5">
          {row('by', step.target.by)}
          {row(
            'target',
            step.target.by === 'role'
              ? `${step.target.role}${step.target.name ? ` / ${step.target.name}` : ''}`
              : step.target.value,
          )}
          {step.button && row('button', step.button)}
        </div>
      );
    case 'fill':
    case 'type':
      return (
        <div className="space-y-0.5">
          {row('by', step.target.by)}
          {row(
            'target',
            step.target.by === 'role' ? step.target.role : step.target.value,
          )}
          {row(
            'value',
            'literal' in step.value
              ? step.value.literal
              : 'var' in step.value
                ? `$${step.value.var}`
                : '(dynamic)',
          )}
        </div>
      );
    case 'expect':
      return (
        <div className="space-y-0.5">
          {row(
            'on',
            typeof step.assertion.on === 'string'
              ? step.assertion.on
              : step.assertion.on.by,
          )}
          {row('is', step.assertion.is)}
          {('not' in step.assertion && step.assertion.not) && row('not', 'true')}
        </div>
      );
    case 'group':
      return (
        <div className="space-y-0.5">
          {row('title', step.title)}
          {row('steps', String(step.steps.length))}
        </div>
      );
    case 'raw':
      return (
        <div className="rounded bg-muted p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap line-clamp-3">
          {step.code || '(empty)'}
        </div>
      );
    case 'comment':
      return (
        <div className="text-xs text-muted-foreground italic">
          {step.text || '(empty)'}
        </div>
      );
    default:
      return (
        <p className="text-xs text-muted-foreground">
          Select this step to edit it in the inspector.
        </p>
      );
  }
}
