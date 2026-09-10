'use client';

import type { Assertion, Target, ValueRef } from './ir-types';
import { defaultTarget, defaultValueRef } from './ir-types';
import { TargetEditor } from './target-editor';
import { ValueRefEditor } from './value-ref-editor';

interface Props {
  value: Assertion;
  onChange: (next: Assertion) => void;
  disabled?: boolean;
}

type OnKind = 'element' | 'page' | 'response' | 'console' | 'network';

const ELEMENT_IS_OPTIONS = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'checked', label: 'Checked' },
  { value: 'editable', label: 'Editable' },
  { value: 'focused', label: 'Focused' },
  { value: 'text', label: 'Has text' },
  { value: 'containsText', label: 'Contains text' },
  { value: 'value', label: 'Has value' },
  { value: 'attribute', label: 'Has attribute' },
  { value: 'class', label: 'Has class' },
  { value: 'count', label: 'Count equals' },
  { value: 'screenshotMatches', label: 'Screenshot matches' },
] as const;

const PAGE_IS_OPTIONS = [
  { value: 'url', label: 'URL equals' },
  { value: 'title', label: 'Title equals' },
] as const;

const RESPONSE_IS_OPTIONS = [
  { value: 'status', label: 'Status code' },
  { value: 'ok', label: 'Is OK (2xx)' },
  { value: 'header', label: 'Has header' },
  { value: 'jsonPath', label: 'JSON path equals' },
] as const;

const CONSOLE_IS_OPTIONS = [
  { value: 'noErrors', label: 'No errors' },
  { value: 'containsText', label: 'Contains text' },
] as const;

const NETWORK_IS_OPTIONS = [
  { value: 'noFailedRequests', label: 'No failed requests' },
  { value: 'noStatusAtOrAbove', label: 'No status >= threshold' },
] as const;

const ELEMENT_VALUE_IS = new Set([
  'text', 'containsText', 'value', 'attribute', 'class', 'count',
]);

function getOnKind(a: Assertion): OnKind {
  if (a.on === 'page') return 'page';
  if (a.on === 'response') return 'response';
  if (a.on === 'console') return 'console';
  if (a.on === 'network') return 'network';
  return 'element';
}

function defaultForOnKind(kind: OnKind, existing: Assertion): Assertion {
  switch (kind) {
    case 'element':
      return { on: defaultTarget(), is: 'visible' };
    case 'page':
      return { on: 'page', is: 'url', expected: defaultValueRef() };
    case 'response':
      return { on: 'response', is: 'status', expected: defaultValueRef() };
    case 'console':
      return { on: 'console', is: 'noErrors' };
    case 'network':
      return { on: 'network', is: 'noFailedRequests' };
  }
  // fallback
  return existing;
}

function needsExpected(a: Assertion): boolean {
  if (a.on === 'page') return true;
  if (a.on === 'response') return true;
  if (a.on === 'console') return a.is === 'containsText';
  if (a.on === 'network') return a.is === 'noStatusAtOrAbove';
  if (typeof a.on === 'object') {
    return ELEMENT_VALUE_IS.has(a.is as string) || a.is === 'screenshotMatches';
  }
  return false;
}

function hasNot(a: Assertion): boolean {
  return a.on !== 'console' && a.on !== 'network';
}

export function AssertionEditor({ value, onChange, disabled }: Props) {
  const onKind = getOnKind(value);

  function handleOnKindChange(newKind: OnKind) {
    onChange(defaultForOnKind(newKind, value));
  }

  function handleIsChange(is: string) {
    const base = { ...value, is } as Assertion;
    // When switching to a "value needed" assertion, add expected
    if (
      needsExpected({ ...value, is } as Assertion) &&
      !('expected' in value)
    ) {
      (base as Record<string, unknown>)['expected'] = defaultValueRef();
    }
    onChange(base);
  }

  const isOptions =
    onKind === 'element'
      ? ELEMENT_IS_OPTIONS
      : onKind === 'page'
        ? PAGE_IS_OPTIONS
        : onKind === 'response'
          ? RESPONSE_IS_OPTIONS
          : onKind === 'console'
            ? CONSOLE_IS_OPTIONS
            : NETWORK_IS_OPTIONS;

  const selectCls =
    'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

  return (
    <fieldset
      className="space-y-3"
      disabled={disabled}
      aria-label="Assertion editor"
    >
      {/* On type selector */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            On
          </span>
          <select
            className={selectCls}
            value={onKind}
            onChange={(e) => handleOnKindChange(e.target.value as OnKind)}
            aria-label="Assertion target type"
          >
            <option value="element">Element</option>
            <option value="page">Page</option>
            <option value="response">Response</option>
            <option value="console">Console</option>
            <option value="network">Network</option>
          </select>
        </div>

        {/* Is selector */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Is
          </span>
          <select
            className={selectCls}
            value={value.is}
            onChange={(e) => handleIsChange(e.target.value)}
            aria-label="Assertion condition"
          >
            {isOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Not checkbox */}
        {hasNot(value) && (
          <div className="flex flex-col gap-1 justify-end pb-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none h-8">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={('not' in value ? value.not : undefined) ?? false}
                onChange={(e) => {
                  const not = e.target.checked || undefined;
                  onChange({ ...value, not } as Assertion);
                }}
                aria-label="Negate assertion"
              />
              Not
            </label>
          </div>
        )}
      </div>

      {/* Element target */}
      {onKind === 'element' && typeof value.on === 'object' && (
        <TargetEditor
          label="Target element"
          value={value.on}
          onChange={(t: Target) => onChange({ ...value, on: t } as Assertion)}
        />
      )}

      {/* Attribute name for attribute assertion */}
      {onKind === 'element' && value.is === 'attribute' && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Attribute name
          </span>
          <input
            type="text"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={
              'attribute' in value && value.attribute ? value.attribute : ''
            }
            onChange={(e) =>
              onChange({ ...value, attribute: e.target.value } as Assertion)
            }
            placeholder="aria-label"
            aria-label="Attribute name"
          />
        </div>
      )}

      {/* Screenshot name for screenshotMatches */}
      {onKind === 'element' && value.is === 'screenshotMatches' && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Snapshot name
          </span>
          <input
            type="text"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={
              'name' in value && typeof value.name === 'string'
                ? value.name
                : ''
            }
            onChange={(e) =>
              onChange({ ...value, name: e.target.value } as Assertion)
            }
            placeholder="my-snapshot"
            aria-label="Snapshot name"
          />
        </div>
      )}

      {/* Response URL pattern */}
      {onKind === 'response' && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            URL pattern (optional)
          </span>
          <input
            type="text"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={
              'urlPattern' in value && value.urlPattern
                ? value.urlPattern
                : ''
            }
            onChange={(e) =>
              onChange({
                ...value,
                urlPattern: e.target.value || undefined,
              } as Assertion)
            }
            placeholder="**/api/**"
            aria-label="Response URL pattern"
          />
        </div>
      )}

      {/* Expected ValueRef */}
      {needsExpected(value) && value.is !== 'screenshotMatches' && (
        <ValueRefEditor
          label="Expected value"
          value={
            'expected' in value && value.expected
              ? (value.expected as ValueRef)
              : defaultValueRef()
          }
          onChange={(v: ValueRef) =>
            onChange({ ...value, expected: v } as Assertion)
          }
        />
      )}
    </fieldset>
  );
}
