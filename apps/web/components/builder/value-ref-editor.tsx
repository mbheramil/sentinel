'use client';

import { LockIcon } from 'lucide-react';
import type { ValueRef } from './ir-types';

interface Props {
  value: ValueRef;
  onChange: (next: ValueRef) => void;
  disabled?: boolean;
  label?: string;
}

type RefKind = 'literal' | 'variable' | 'secret' | 'faker' | 'runToken';

const FAKER_METHODS = [
  'person.fullName',
  'person.firstName',
  'person.lastName',
  'internet.email',
  'internet.username',
  'internet.password',
  'internet.url',
  'phone.number',
  'company.name',
  'company.buzzPhrase',
  'lorem.sentence',
  'lorem.word',
  'lorem.paragraph',
  'number.int',
  'string.uuid',
  'string.alphanumeric',
  'date.recent',
  'date.future',
] as const;

const RUN_TOKENS = [
  { value: 'runId', label: 'Run ID' },
  { value: 'runShortId', label: 'Run Short ID' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'testEmail', label: 'Test Email' },
] as const;

function getKind(v: ValueRef): RefKind {
  if ('literal' in v) return 'literal';
  if ('var' in v) return 'variable';
  if ('secret' in v) return 'secret';
  if ('faker' in v) return 'faker';
  return 'runToken';
}

function defaultValueForKind(kind: RefKind): ValueRef {
  switch (kind) {
    case 'literal':
      return { literal: '' };
    case 'variable':
      return { var: '' };
    case 'secret':
      return { secret: '' };
    case 'faker':
      return { faker: 'person.fullName' };
    case 'runToken':
      return { runToken: 'runId' };
  }
}

const KIND_LABELS: Record<RefKind, string> = {
  literal: 'Literal',
  variable: 'Variable',
  secret: 'Secret',
  faker: 'Faker',
  runToken: 'Run token',
};

const VALUE_LABELS: Record<RefKind, string> = {
  literal: 'Value',
  variable: 'Variable name',
  secret: 'Secret key',
  faker: 'Faker method',
  runToken: 'Token',
};

export function ValueRefEditor({ value, onChange, disabled, label }: Props) {
  const kind = getKind(value);

  const inputCls =
    'h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

  return (
    <fieldset
      className="space-y-2"
      disabled={disabled}
      aria-label={label ?? 'Value reference'}
    >
      {label && (
        <legend className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          {label}
        </legend>
      )}

      <div className="flex gap-2 flex-wrap">
        {/* Kind selector */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Type
          </span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={kind}
            onChange={(e) =>
              onChange(defaultValueForKind(e.target.value as RefKind))
            }
            aria-label="Value type"
          >
            {(Object.keys(KIND_LABELS) as RefKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        {/* Value input — varies by kind */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {VALUE_LABELS[kind]}
          </span>

          {kind === 'literal' && (
            <input
              type="text"
              className={inputCls}
              value={'literal' in value ? value.literal : ''}
              onChange={(e) => onChange({ literal: e.target.value })}
              placeholder="Enter value…"
              aria-label="Literal value"
            />
          )}

          {kind === 'variable' && (
            <input
              type="text"
              className={inputCls + ' font-mono'}
              value={'var' in value ? value.var : ''}
              onChange={(e) => onChange({ var: e.target.value })}
              placeholder="myVariable"
              aria-label="Variable name"
            />
          )}

          {kind === 'secret' && (
            <div className="relative">
              <LockIcon
                className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="password"
                className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                value={'secret' in value ? value.secret : ''}
                onChange={(e) => onChange({ secret: e.target.value })}
                placeholder="SECRET_KEY"
                autoComplete="new-password"
                aria-label="Secret key (write-only)"
              />
            </div>
          )}

          {kind === 'faker' && (
            <select
              className={inputCls + ' font-mono'}
              value={'faker' in value ? value.faker : 'person.fullName'}
              onChange={(e) => onChange({ faker: e.target.value })}
              aria-label="Faker method"
            >
              {FAKER_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          {kind === 'runToken' && (
            <select
              className={inputCls}
              value={'runToken' in value ? value.runToken : 'runId'}
              onChange={(e) =>
                onChange({
                  runToken: e.target.value as
                    | 'runId'
                    | 'runShortId'
                    | 'timestamp'
                    | 'testEmail',
                })
              }
              aria-label="Run token type"
            >
              {RUN_TOKENS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </fieldset>
  );
}
