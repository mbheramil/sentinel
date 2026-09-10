'use client';

import { AlertTriangleIcon, InfoIcon } from 'lucide-react';
import type { Step, Target, ValueRef, Assertion } from './ir-types';
import { defaultTarget, defaultValueRef } from './ir-types';
import { TargetEditor } from './target-editor';
import { ValueRefEditor } from './value-ref-editor';
import { AssertionEditor } from './assertion-editor';

interface Props {
  step: Step;
  onChange: (next: Step) => void;
}

const sectionCls = 'space-y-3';
const labelCls =
  'text-[10px] font-medium text-muted-foreground uppercase tracking-wide';
const inputCls =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring';
const selectCls =
  'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className={labelCls}>{label}</p>
      {children}
    </div>
  );
}

export function StepInspector({ step, onChange }: Props) {
  switch (step.kind) {
    case 'goto':
      return (
        <div className={sectionCls}>
          <Field label="URL">
            <input
              type="text"
              className={inputCls}
              value={step.url}
              onChange={(e) => onChange({ ...step, url: e.target.value })}
              placeholder="https://example.com"
              aria-label="Navigation URL"
            />
          </Field>
          <Field label="Wait until">
            <select
              className={selectCls}
              value={step.waitUntil ?? ''}
              onChange={(e) =>
                onChange({
                  ...step,
                  waitUntil:
                    (e.target.value as typeof step.waitUntil) || undefined,
                })
              }
              aria-label="Wait until event"
            >
              <option value="">Default (load)</option>
              <option value="load">load</option>
              <option value="domcontentloaded">domcontentloaded</option>
              <option value="networkidle">networkidle</option>
            </select>
          </Field>
          <Field label="Expect HTTP status (optional)">
            <input
              type="number"
              className={inputCls}
              value={step.expectStatus ?? ''}
              onChange={(e) =>
                onChange({
                  ...step,
                  expectStatus:
                    e.target.value === ''
                      ? undefined
                      : parseInt(e.target.value, 10),
                })
              }
              placeholder="200"
              min={100}
              max={599}
              aria-label="Expected HTTP status code"
            />
          </Field>
        </div>
      );

    case 'click':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <Field label="Mouse button">
            <select
              className={selectCls}
              value={step.button ?? 'left'}
              onChange={(e) =>
                onChange({
                  ...step,
                  button: e.target.value as typeof step.button,
                })
              }
              aria-label="Mouse button"
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="middle">Middle</option>
            </select>
          </Field>
          <Field label="Click count">
            <input
              type="number"
              className={inputCls}
              value={step.clickCount ?? 1}
              min={1}
              max={5}
              onChange={(e) =>
                onChange({
                  ...step,
                  clickCount:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
              aria-label="Click count"
            />
          </Field>
        </div>
      );

    case 'fill':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <ValueRefEditor
            label="Value to fill"
            value={step.value}
            onChange={(v: ValueRef) => onChange({ ...step, value: v })}
          />
        </div>
      );

    case 'type':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <ValueRefEditor
            label="Value to type"
            value={step.value}
            onChange={(v: ValueRef) => onChange({ ...step, value: v })}
          />
          <Field label="Key delay (ms, optional)">
            <input
              type="number"
              className={inputCls}
              value={step.delayMs ?? ''}
              min={0}
              onChange={(e) =>
                onChange({
                  ...step,
                  delayMs:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="0"
              aria-label="Delay between keystrokes in milliseconds"
            />
          </Field>
        </div>
      );

    case 'press':
      return (
        <div className={sectionCls}>
          <Field label="Key">
            <input
              type="text"
              className={inputCls}
              value={step.key}
              onChange={(e) => onChange({ ...step, key: e.target.value })}
              placeholder="Enter"
              aria-label="Key to press"
            />
          </Field>
          {step.target ? (
            <TargetEditor
              label="Target element (optional)"
              value={step.target}
              onChange={(t: Target) => onChange({ ...step, target: t })}
            />
          ) : (
            <button
              type="button"
              className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                onChange({ ...step, target: defaultTarget() })
              }
            >
              + Add target element
            </button>
          )}
        </div>
      );

    case 'select':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <Field label="Values">
            <div className="space-y-2">
              {step.values.map((v, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <ValueRefEditor
                      value={v}
                      onChange={(nv: ValueRef) => {
                        const values = [...step.values];
                        values[i] = nv;
                        onChange({ ...step, values });
                      }}
                    />
                  </div>
                  {step.values.length > 1 && (
                    <button
                      type="button"
                      className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        const values = step.values.filter((_, j) => j !== i);
                        onChange({ ...step, values });
                      }}
                      aria-label={`Remove value ${i + 1}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  onChange({ ...step, values: [...step.values, defaultValueRef()] })
                }
              >
                + Add value
              </button>
            </div>
          </Field>
        </div>
      );

    case 'check':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <Field label="State">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={step.checked}
                onChange={(e) => onChange({ ...step, checked: e.target.checked })}
                aria-label="Checked state"
              />
              Check (enable) the element
            </label>
          </Field>
        </div>
      );

    case 'upload':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="File input element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <Field label="File paths">
            <div className="space-y-2">
              {step.files.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    className={inputCls}
                    value={f}
                    onChange={(e) => {
                      const files = [...step.files];
                      files[i] = e.target.value;
                      onChange({ ...step, files });
                    }}
                    placeholder="/path/to/file.pdf"
                    aria-label={`File path ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 rounded"
                    onClick={() => {
                      const files = step.files.filter((_, j) => j !== i);
                      onChange({ ...step, files });
                    }}
                    aria-label={`Remove file ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => onChange({ ...step, files: [...step.files, ''] })}
              >
                + Add file
              </button>
            </div>
          </Field>
        </div>
      );

    case 'hover':
    case 'scrollTo':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
        </div>
      );

    case 'waitFor':
      return (
        <div className={sectionCls}>
          <TargetEditor
            label="Target element"
            value={step.target}
            onChange={(t: Target) => onChange({ ...step, target: t })}
          />
          <Field label="State">
            <select
              className={selectCls}
              value={step.state}
              onChange={(e) =>
                onChange({
                  ...step,
                  state: e.target.value as typeof step.state,
                })
              }
              aria-label="Wait for state"
            >
              <option value="visible">visible</option>
              <option value="hidden">hidden</option>
              <option value="attached">attached</option>
              <option value="detached">detached</option>
            </select>
          </Field>
          <Field label="Timeout (ms, optional)">
            <input
              type="number"
              className={inputCls}
              value={step.timeoutMs ?? ''}
              min={0}
              onChange={(e) =>
                onChange({
                  ...step,
                  timeoutMs:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="30000"
              aria-label="Timeout in milliseconds"
            />
          </Field>
        </div>
      );

    case 'expect':
      return (
        <div className={sectionCls}>
          <AssertionEditor
            value={step.assertion}
            onChange={(a: Assertion) => onChange({ ...step, assertion: a })}
          />
        </div>
      );

    case 'screenshot':
      return (
        <div className={sectionCls}>
          <Field label="Screenshot name">
            <input
              type="text"
              className={inputCls}
              value={step.name}
              onChange={(e) => onChange({ ...step, name: e.target.value })}
              placeholder="my-screenshot"
              aria-label="Screenshot file name"
            />
          </Field>
          <Field label="Options">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={step.fullPage ?? false}
                onChange={(e) =>
                  onChange({ ...step, fullPage: e.target.checked || undefined })
                }
                aria-label="Full page screenshot"
              />
              Full page screenshot
            </label>
          </Field>
        </div>
      );

    case 'apiRequest':
      return (
        <div className={sectionCls}>
          <Field label="Method">
            <select
              className={selectCls}
              value={step.method.toUpperCase()}
              onChange={(e) => onChange({ ...step, method: e.target.value })}
              aria-label="HTTP method"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input
              type="text"
              className={inputCls}
              value={step.url}
              onChange={(e) => onChange({ ...step, url: e.target.value })}
              placeholder="https://api.example.com/endpoint"
              aria-label="API request URL"
            />
          </Field>
          <Field label="Save response as (optional)">
            <input
              type="text"
              className={inputCls}
              value={step.saveAs ?? ''}
              onChange={(e) =>
                onChange({ ...step, saveAs: e.target.value || undefined })
              }
              placeholder="apiResponse"
              aria-label="Variable name to save response"
            />
          </Field>
        </div>
      );

    case 'pollApi':
      return (
        <div className={sectionCls}>
          <Field label="Method">
            <select
              className={selectCls}
              value={step.method.toUpperCase()}
              onChange={(e) => onChange({ ...step, method: e.target.value })}
              aria-label="HTTP method"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input
              type="text"
              className={inputCls}
              value={step.url}
              onChange={(e) => onChange({ ...step, url: e.target.value })}
              placeholder="https://api.example.com/status"
              aria-label="Poll URL"
            />
          </Field>
          <Field label="Until (assertion)">
            <AssertionEditor
              value={step.until}
              onChange={(a: Assertion) => onChange({ ...step, until: a })}
            />
          </Field>
          <Field label="Timeout (ms, optional)">
            <input
              type="number"
              className={inputCls}
              value={step.timeoutMs ?? ''}
              min={0}
              onChange={(e) =>
                onChange({
                  ...step,
                  timeoutMs:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="30000"
              aria-label="Poll timeout in milliseconds"
            />
          </Field>
          <Field label="Interval (ms, optional)">
            <input
              type="number"
              className={inputCls}
              value={step.intervalMs ?? ''}
              min={100}
              onChange={(e) =>
                onChange({
                  ...step,
                  intervalMs:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="1000"
              aria-label="Poll interval in milliseconds"
            />
          </Field>
        </div>
      );

    case 'waitForInbox':
      return (
        <div className={sectionCls}>
          <Field label="Provider">
            <select
              className={selectCls}
              value={step.provider}
              onChange={(e) =>
                onChange({
                  ...step,
                  provider: e.target.value as typeof step.provider,
                })
              }
              aria-label="Email provider"
            >
              <option value="mailpit">Mailpit</option>
              <option value="mailosaur">Mailosaur</option>
              <option value="imap">IMAP</option>
            </select>
          </Field>
          <ValueRefEditor
            label="To (email address)"
            value={step.to}
            onChange={(v: ValueRef) => onChange({ ...step, to: v })}
          />
          <Field label="Subject contains (optional)">
            <input
              type="text"
              className={inputCls}
              value={step.subjectContains ?? ''}
              onChange={(e) =>
                onChange({ ...step, subjectContains: e.target.value || undefined })
              }
              placeholder="Welcome to…"
              aria-label="Subject filter"
            />
          </Field>
          <Field label="Save as (optional)">
            <input
              type="text"
              className={inputCls}
              value={step.saveAs ?? ''}
              onChange={(e) =>
                onChange({ ...step, saveAs: e.target.value || undefined })
              }
              placeholder="email"
              aria-label="Variable name to save email"
            />
          </Field>
        </div>
      );

    case 'waitForCapture':
      return (
        <div className={sectionCls}>
          <Field label="Capture ID">
            <input
              type="text"
              className={inputCls}
              value={step.captureId}
              onChange={(e) => onChange({ ...step, captureId: e.target.value })}
              placeholder="my-capture-slug"
              aria-label="Capture endpoint ID"
            />
          </Field>
          <Field label="Save as (optional)">
            <input
              type="text"
              className={inputCls}
              value={step.saveAs ?? ''}
              onChange={(e) =>
                onChange({ ...step, saveAs: e.target.value || undefined })
              }
              placeholder="capturePayload"
              aria-label="Variable name to save captured event"
            />
          </Field>
        </div>
      );

    case 'group':
      return (
        <div className={sectionCls}>
          <Field label="Group title">
            <input
              type="text"
              className={inputCls}
              value={step.title}
              onChange={(e) => onChange({ ...step, title: e.target.value })}
              placeholder="My group"
              aria-label="Group title for test.step()"
            />
          </Field>
          <div className="flex items-center gap-1.5 rounded-md bg-muted/50 border border-border px-2.5 py-2 text-xs text-muted-foreground">
            <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Nested steps can be added in the step list when a group is selected.
          </div>
        </div>
      );

    case 'comment':
      return (
        <div className={sectionCls}>
          <Field label="Comment text">
            <textarea
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              rows={3}
              value={step.text}
              onChange={(e) => onChange({ ...step, text: e.target.value })}
              placeholder="Describe what the next steps do…"
              aria-label="Comment text"
            />
          </Field>
        </div>
      );

    case 'raw':
      return (
        <div className={sectionCls}>
          <div
            role="alert"
            className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertTriangleIcon
              className="h-3.5 w-3.5 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>
              Raw steps mark the test as <strong>hybrid</strong>. The Builder
              cannot fully round-trip raw code — changes may not survive a
              re-open.
            </span>
          </div>
          <Field label="Playwright code">
            <textarea
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[6rem]"
              value={step.code}
              onChange={(e) => onChange({ ...step, code: e.target.value })}
              placeholder="await page.evaluate(() => { /* ... */ });"
              spellCheck={false}
              aria-label="Raw Playwright TypeScript code"
            />
          </Field>
        </div>
      );

    default: {
      const _: never = step;
      return (
        <p className="text-xs text-muted-foreground">
          Unknown step kind. Select a different step.
        </p>
      );
    }
  }
}
