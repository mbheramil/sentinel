// IR types for the builder UI.
// These mirror packages/ir/src/types.ts exactly — keep in sync.

export type ValueRef =
  | { literal: string }
  | { var: string }
  | { secret: string }
  | { faker: string }
  | { runToken: 'runId' | 'runShortId' | 'timestamp' | 'testEmail' };

export type Target = (
  | { by: 'role'; role: string; name?: string; exact?: boolean }
  | { by: 'label' | 'placeholder' | 'text' | 'altText' | 'title'; value: string; exact?: boolean }
  | { by: 'testId'; value: string }
  | { by: 'css' | 'xpath'; value: string }
) & { nth?: number; frame?: Target; within?: Target };

export type Assertion =
  | { on: Target; is: 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked' | 'editable' | 'focused'; not?: boolean }
  | { on: Target; is: 'text' | 'containsText' | 'value' | 'attribute' | 'class' | 'count'; expected: ValueRef; attribute?: string; not?: boolean }
  | { on: 'page'; is: 'url' | 'title'; expected: ValueRef; not?: boolean }
  | { on: 'response'; is: 'status' | 'ok' | 'header' | 'jsonPath'; urlPattern?: string; path?: string; header?: string; expected: ValueRef; not?: boolean }
  | { on: 'console'; is: 'noErrors' | 'containsText'; expected?: ValueRef; ignorePatterns?: string[] }
  | { on: 'network'; is: 'noFailedRequests' | 'noStatusAtOrAbove'; expected?: ValueRef; ignorePatterns?: string[] }
  | { on: Target; is: 'screenshotMatches'; name: string; maxDiffPixelRatio?: number };

export type Step =
  | { kind: 'goto'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; expectStatus?: number }
  | { kind: 'click'; target: Target; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { kind: 'fill'; target: Target; value: ValueRef }
  | { kind: 'type'; target: Target; value: ValueRef; delayMs?: number }
  | { kind: 'press'; target?: Target; key: string }
  | { kind: 'select'; target: Target; values: ValueRef[] }
  | { kind: 'check'; target: Target; checked: boolean }
  | { kind: 'upload'; target: Target; files: string[] }
  | { kind: 'hover'; target: Target }
  | { kind: 'scrollTo'; target: Target }
  | { kind: 'waitFor'; target: Target; state: 'visible' | 'hidden' | 'attached' | 'detached'; timeoutMs?: number }
  | { kind: 'expect'; assertion: Assertion }
  | { kind: 'screenshot'; name: string; fullPage?: boolean }
  | { kind: 'apiRequest'; method: string; url: string; body?: unknown; saveAs?: string }
  | { kind: 'pollApi'; method: string; url: string; until: Assertion; timeoutMs?: number; intervalMs?: number }
  | { kind: 'waitForInbox'; provider: 'mailpit' | 'mailosaur' | 'imap'; to: ValueRef; subjectContains?: string; timeoutMs?: number; saveAs?: string }
  | { kind: 'waitForCapture'; captureId: string; matchBody?: Record<string, unknown>; timeoutMs?: number; saveAs?: string }
  | { kind: 'group'; title: string; steps: Step[] }
  | { kind: 'comment'; text: string }
  | { kind: 'raw'; code: string };

export interface StepIr {
  version: 1;
  steps: Step[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function defaultTarget(): Target {
  return { by: 'role', role: '' };
}

export function defaultValueRef(): ValueRef {
  return { literal: '' };
}

export function defaultAssertion(): Assertion {
  return { on: defaultTarget(), is: 'visible' };
}

export function defaultStep(kind: Step['kind']): Step {
  switch (kind) {
    case 'goto':
      return { kind: 'goto', url: '' };
    case 'click':
      return { kind: 'click', target: defaultTarget() };
    case 'fill':
      return { kind: 'fill', target: defaultTarget(), value: defaultValueRef() };
    case 'type':
      return { kind: 'type', target: defaultTarget(), value: defaultValueRef() };
    case 'press':
      return { kind: 'press', key: 'Enter' };
    case 'select':
      return { kind: 'select', target: defaultTarget(), values: [defaultValueRef()] };
    case 'check':
      return { kind: 'check', target: defaultTarget(), checked: true };
    case 'upload':
      return { kind: 'upload', target: defaultTarget(), files: [] };
    case 'hover':
      return { kind: 'hover', target: defaultTarget() };
    case 'scrollTo':
      return { kind: 'scrollTo', target: defaultTarget() };
    case 'waitFor':
      return { kind: 'waitFor', target: defaultTarget(), state: 'visible' };
    case 'expect':
      return { kind: 'expect', assertion: defaultAssertion() };
    case 'screenshot':
      return { kind: 'screenshot', name: 'screenshot' };
    case 'apiRequest':
      return { kind: 'apiRequest', method: 'GET', url: '' };
    case 'pollApi':
      return { kind: 'pollApi', method: 'GET', url: '', until: defaultAssertion() };
    case 'waitForInbox':
      return { kind: 'waitForInbox', provider: 'mailpit', to: defaultValueRef() };
    case 'waitForCapture':
      return { kind: 'waitForCapture', captureId: '' };
    case 'group':
      return { kind: 'group', title: 'Group', steps: [] };
    case 'comment':
      return { kind: 'comment', text: '' };
    case 'raw':
      return { kind: 'raw', code: '' };
  }
}

export function hasFragileTarget(step: Step): boolean {
  function targetIsFragile(t: Target): boolean {
    return t.by === 'css' || t.by === 'xpath';
  }
  if ('target' in step && step.target) return targetIsFragile(step.target as Target);
  if (step.kind === 'expect' && typeof step.assertion.on === 'object') {
    return targetIsFragile(step.assertion.on);
  }
  return false;
}

export function summarizeTarget(t: Target): string {
  switch (t.by) {
    case 'role':
      return t.name ? `${t.name} (${t.role})` : t.role || '(role)';
    case 'label':
    case 'placeholder':
    case 'text':
    case 'altText':
    case 'title':
      return t.value || `(${t.by})`;
    case 'testId':
      return `testId:${t.value}`;
    case 'css':
    case 'xpath':
      return t.value || `(${t.by})`;
  }
}

export function summarizeValue(v: ValueRef): string {
  if ('literal' in v) return v.literal ? `"${v.literal}"` : '""';
  if ('var' in v) return `$${v.var}`;
  if ('secret' in v) return `[secret:${v.secret}]`;
  if ('faker' in v) return `faker.${v.faker}()`;
  if ('runToken' in v) return `run.${v.runToken}`;
  return '?';
}

export function summarizeStep(step: Step): string {
  switch (step.kind) {
    case 'goto':
      return `goto ${step.url || '(url)'}`;
    case 'click':
      return `click ${summarizeTarget(step.target)}`;
    case 'fill':
      return `fill ${summarizeTarget(step.target)} → ${summarizeValue(step.value)}`;
    case 'type':
      return `type ${summarizeTarget(step.target)} → ${summarizeValue(step.value)}`;
    case 'press':
      return `press ${step.key}`;
    case 'select':
      return `select ${summarizeTarget(step.target)}`;
    case 'check':
      return `${step.checked ? 'check' : 'uncheck'} ${summarizeTarget(step.target)}`;
    case 'upload':
      return `upload ${step.files.length} file(s) to ${summarizeTarget(step.target)}`;
    case 'hover':
      return `hover ${summarizeTarget(step.target)}`;
    case 'scrollTo':
      return `scroll to ${summarizeTarget(step.target)}`;
    case 'waitFor':
      return `wait for ${summarizeTarget(step.target)} to be ${step.state}`;
    case 'expect': {
      const { assertion } = step;
      const onStr =
        typeof assertion.on === 'string'
          ? assertion.on
          : summarizeTarget(assertion.on);
      return `expect ${onStr} ${assertion.is}`;
    }
    case 'screenshot':
      return `screenshot "${step.name}"${step.fullPage ? ' (full page)' : ''}`;
    case 'apiRequest':
      return `${step.method.toUpperCase()} ${step.url || '(url)'}`;
    case 'pollApi':
      return `poll ${step.method.toUpperCase()} ${step.url || '(url)'}`;
    case 'waitForInbox':
      return `wait for inbox (${step.provider})`;
    case 'waitForCapture':
      return `wait for capture "${step.captureId}"`;
    case 'group':
      return `group: ${step.title}`;
    case 'comment':
      return step.text || '(comment)';
    case 'raw':
      return 'raw code';
  }
}

export type StepKind = Step['kind'];

export const STEP_KIND_META: Record<
  StepKind,
  { label: string; color: string; description: string }
> = {
  goto: { label: 'goto', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', description: 'Navigate to a URL' },
  click: { label: 'click', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200', description: 'Click an element' },
  fill: { label: 'fill', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', description: 'Fill an input with a value' },
  type: { label: 'type', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200', description: 'Type into an element key-by-key' },
  press: { label: 'press', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200', description: 'Press a keyboard key' },
  select: { label: 'select', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200', description: 'Select an option from a dropdown' },
  check: { label: 'check', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200', description: 'Check or uncheck a checkbox' },
  upload: { label: 'upload', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', description: 'Upload file(s)' },
  hover: { label: 'hover', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', description: 'Hover over an element' },
  scrollTo: { label: 'scroll', color: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200', description: 'Scroll element into view' },
  waitFor: { label: 'waitFor', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200', description: 'Wait for element state' },
  expect: { label: 'expect', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200', description: 'Assert a condition' },
  screenshot: { label: 'screenshot', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200', description: 'Capture a screenshot' },
  apiRequest: { label: 'api', color: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200', description: 'Make an API request' },
  pollApi: { label: 'pollApi', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', description: 'Poll an API until a condition' },
  waitForInbox: { label: 'inbox', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200', description: 'Wait for an email to arrive' },
  waitForCapture: { label: 'capture', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', description: 'Wait for a captured webhook event' },
  group: { label: 'group', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', description: 'Group steps under a test.step()' },
  comment: { label: 'comment', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', description: 'Add a code comment' },
  raw: { label: 'raw', color: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200', description: 'Insert raw Playwright code' },
};

export const ALL_STEP_KINDS: StepKind[] = [
  'goto', 'click', 'fill', 'type', 'press', 'select', 'check', 'upload',
  'hover', 'scrollTo', 'waitFor', 'expect', 'screenshot',
  'apiRequest', 'pollApi', 'waitForInbox', 'waitForCapture',
  'group', 'comment', 'raw',
];
