// Step IR type definitions — §8.2
// These types are the source of truth for the step IR discriminated union.

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

export interface CompileResult {
  code: string; // Prettier-formatted TypeScript
  warnings: CompileWarning[];
}

export interface CompileWarning {
  stepIndex: number;
  message: string;
  severity: 'warn' | 'info';
}
