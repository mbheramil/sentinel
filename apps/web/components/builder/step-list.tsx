'use client';

import { useRef, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import type { Step, StepKind } from './ir-types';
import { ALL_STEP_KINDS, STEP_KIND_META, defaultStep } from './ir-types';
import { StepCard } from './step-card';
import { cn } from '@/lib/utils';

interface Props {
  steps: Step[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (newSteps: Step[]) => void;
  onDelete: (index: number) => void;
  onChange: (index: number, newStep: Step) => void;
  onAdd: (step: Step) => void;
}

export function StepList({
  steps,
  selectedIndex,
  onSelect,
  onReorder,
  onDelete,
  onChange,
  onAdd,
}: Props) {
  const dragSrcRef = useRef<number | null>(null);
  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuFilter, setAddMenuFilter] = useState('');

  function handleDragStart(index: number) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      dragSrcRef.current = index;
      setDragSrcIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    };
  }

  function handleDragEnd() {
    return (_e: React.DragEvent<HTMLDivElement>) => {
      dragSrcRef.current = null;
      setDragSrcIndex(null);
      setDragOverIndex(null);
    };
  }

  function handleDragOver(index: number) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    };
  }

  function handleDrop(index: number) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const src = dragSrcRef.current;
      if (src === null || src === index) {
        setDragOverIndex(null);
        return;
      }
      const newSteps = [...steps];
      const [removed] = newSteps.splice(src, 1);
      newSteps.splice(index, 0, removed!);
      onReorder(newSteps);
      dragSrcRef.current = null;
      setDragSrcIndex(null);
      setDragOverIndex(null);
    };
  }

  function handleAdd(kind: StepKind) {
    onAdd(defaultStep(kind));
    setAddMenuOpen(false);
    setAddMenuFilter('');
  }

  const filteredKinds = ALL_STEP_KINDS.filter((k) => {
    if (!addMenuFilter) return true;
    const q = addMenuFilter.toLowerCase();
    return (
      k.includes(q) || STEP_KIND_META[k].description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Empty state */}
      {steps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-lg border border-dashed border-border text-center">
          <p className="text-sm text-muted-foreground">No steps yet.</p>
          <p className="text-xs text-muted-foreground">
            Click &quot;Add step&quot; below to get started.
          </p>
        </div>
      )}

      {/* Step cards */}
      {steps.map((step, i) => (
        <StepCard
          key={i}
          step={step}
          index={i}
          isSelected={selectedIndex === i}
          isDragging={dragSrcIndex === i}
          isDragOver={dragOverIndex === i}
          onSelect={() => onSelect(i)}
          onDelete={() => onDelete(i)}
          onChange={(next) => onChange(i, next)}
          onDragStart={handleDragStart(i)}
          onDragEnd={handleDragEnd()}
          onDragOver={handleDragOver(i)}
          onDrop={handleDrop(i)}
        />
      ))}

      {/* Add step button + dropdown */}
      <div className="relative mt-2">
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 w-full rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground',
            'hover:border-ring hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors',
          )}
          onClick={() => setAddMenuOpen((v) => !v)}
          aria-expanded={addMenuOpen}
          aria-haspopup="listbox"
          aria-label="Add a new step"
        >
          <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Add step
        </button>

        {addMenuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              aria-hidden="true"
              onClick={() => {
                setAddMenuOpen(false);
                setAddMenuFilter('');
              }}
            />

            {/* Dropdown */}
            <div
              className="absolute left-0 right-0 bottom-full mb-1 z-20 rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
              role="dialog"
              aria-label="Add step menu"
            >
              {/* Search */}
              <div className="p-2 border-b border-border">
                <input
                  type="text"
                  className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Search step kinds…"
                  value={addMenuFilter}
                  onChange={(e) => setAddMenuFilter(e.target.value)}
                  autoFocus
                  aria-label="Filter step kinds"
                />
              </div>

              {/* Step kind list */}
              <ul
                className="max-h-56 overflow-y-auto py-1"
                role="listbox"
                aria-label="Step kinds"
              >
                {filteredKinds.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    No matching step kinds.
                  </li>
                )}
                {filteredKinds.map((kind) => {
                  const meta = STEP_KIND_META[kind];
                  return (
                    <li key={kind} role="option" aria-selected="false">
                      <button
                        type="button"
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
                        onClick={() => handleAdd(kind)}
                      >
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0',
                            meta.color,
                          )}
                          aria-hidden="true"
                        >
                          {meta.label}
                        </span>
                        <span className="text-muted-foreground">
                          {meta.description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
