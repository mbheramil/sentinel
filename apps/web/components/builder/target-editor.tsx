'use client';

import { AlertTriangleIcon } from 'lucide-react';
import type { Target } from './ir-types';

interface Props {
  value: Target;
  onChange: (next: Target) => void;
  disabled?: boolean;
  label?: string;
}

const BY_OPTIONS = [
  { value: 'role', label: 'Role' },
  { value: 'label', label: 'Label' },
  { value: 'placeholder', label: 'Placeholder' },
  { value: 'text', label: 'Text' },
  { value: 'altText', label: 'Alt text' },
  { value: 'title', label: 'Title' },
  { value: 'testId', label: 'Test ID' },
  { value: 'css', label: 'CSS' },
  { value: 'xpath', label: 'XPath' },
] as const;

type ByValue = (typeof BY_OPTIONS)[number]['value'];

function defaultForBy(by: ByValue, existing: Target): Target {
  const common = {
    nth: existing.nth,
    frame: existing.frame,
    within: existing.within,
  } as const;
  const commonFiltered = Object.fromEntries(
    Object.entries(common).filter(([, v]) => v !== undefined),
  ) as Partial<Target>;

  switch (by) {
    case 'role':
      return { by: 'role', role: '', ...commonFiltered };
    case 'label':
    case 'placeholder':
    case 'text':
    case 'altText':
    case 'title':
      return { by, value: '', ...commonFiltered };
    case 'testId':
      return { by: 'testId', value: '', ...commonFiltered };
    case 'css':
    case 'xpath':
      return { by, value: '', ...commonFiltered };
  }
}

function getMainValue(t: Target): string {
  if (t.by === 'role') return t.role;
  return t.value;
}

function setMainValue(t: Target, v: string): Target {
  if (t.by === 'role') return { ...t, role: v };
  return { ...t, value: v } as Target;
}

function hasExact(t: Target): boolean {
  return (
    t.by === 'role' ||
    t.by === 'label' ||
    t.by === 'placeholder' ||
    t.by === 'text' ||
    t.by === 'altText' ||
    t.by === 'title'
  );
}

export function TargetEditor({ value, onChange, disabled, label }: Props) {
  const isFragile = value.by === 'css' || value.by === 'xpath';

  function handleByChange(newBy: ByValue) {
    onChange(defaultForBy(newBy, value));
  }

  const inputCls =
    'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

  return (
    <fieldset className="space-y-2" disabled={disabled} aria-label={label ?? 'Target locator'}>
      {label && (
        <legend className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          {label}
        </legend>
      )}

      <div className="flex gap-2 flex-wrap">
        {/* By selector */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">By</span>
          <select
            className={inputCls}
            value={value.by}
            onChange={(e) => handleByChange(e.target.value as ByValue)}
            aria-label="Selector type"
          >
            {BY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Main value input */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {value.by === 'role' ? 'Role' : 'Value'}
          </span>
          <input
            type="text"
            className={inputCls + ' w-full'}
            value={getMainValue(value)}
            onChange={(e) => onChange(setMainValue(value, e.target.value))}
            placeholder={
              value.by === 'role'
                ? 'button'
                : value.by === 'css'
                  ? '.my-selector'
                  : value.by === 'xpath'
                    ? '//button'
                    : 'Enter value…'
            }
            aria-label={value.by === 'role' ? 'ARIA role' : 'Selector value'}
          />
        </div>

        {/* name field for role */}
        {value.by === 'role' && (
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Name (optional)
            </span>
            <input
              type="text"
              className={inputCls + ' w-full'}
              value={value.name ?? ''}
              onChange={(e) =>
                onChange({ ...value, name: e.target.value || undefined })
              }
              placeholder="Get a quote"
              aria-label="Accessible name"
            />
          </div>
        )}
      </div>

      {/* Options row */}
      <div className="flex gap-4 items-center flex-wrap">
        {hasExact(value) && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={(value as { exact?: boolean }).exact ?? false}
              onChange={(e) => {
                const exact = e.target.checked || undefined;
                onChange({ ...value, exact } as Target);
              }}
              aria-label="Exact match"
            />
            Exact match
          </label>
        )}

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="target-nth"
            className="text-xs text-muted-foreground"
          >
            nth
          </label>
          <input
            id="target-nth"
            type="number"
            className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            min={0}
            value={value.nth ?? ''}
            onChange={(e) => {
              const nth =
                e.target.value === ''
                  ? undefined
                  : parseInt(e.target.value, 10);
              onChange({ ...value, nth } as Target);
            }}
            placeholder="—"
            aria-label="Nth match (zero-indexed)"
          />
        </div>
      </div>

      {isFragile && (
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangleIcon
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          {value.by.toUpperCase()} selectors are fragile — prefer getByRole,
          getByLabel, or getByTestId
        </div>
      )}
    </fieldset>
  );
}
