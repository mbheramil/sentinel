import prettier from 'prettier';
import type { Assertion, Step, StepIr, Target, ValueRef, CompileResult, CompileWarning } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape a string literal for inclusion in generated TypeScript source. */
function esc(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Extract a raw CSS/XPath selector string from a Target for use in frameLocator().
 * Falls back to a best-effort representation for non-CSS targets.
 */
function extractSelectorString(t: Target): string {
  if (t.by === 'css' || t.by === 'xpath') return t.value;
  if (t.by === 'testId') return `[data-testid="${t.value}"]`;
  if (
    t.by === 'label' ||
    t.by === 'placeholder' ||
    t.by === 'text' ||
    t.by === 'altText' ||
    t.by === 'title'
  ) {
    return t.value;
  }
  // by === 'role'
  if (t.by === 'role') {
    return `[role="${t.role}"]${t.name ? `[name="${t.name}"]` : ''}`;
  }
  return '[unknown]';
}

// ── Target compilation ────────────────────────────────────────────────────────

/**
 * Compile a Target to a Playwright locator expression.
 * Warnings are pushed into the provided array (keyed by step index).
 */
function compileTarget(
  t: Target,
  warnings: CompileWarning[],
  stepIndex: number,
  pageExpr = 'page',
): string {
  // Handle frame modifier — wraps the inner locator in a frameLocator call.
  // frameLocator() takes a CSS/XPath selector string directly, so we extract
  // the raw selector from the frame Target rather than a full locator chain.
  let rootExpr = pageExpr;
  if (t.frame) {
    const frameSel = extractSelectorString(t.frame);
    rootExpr = `${pageExpr}.frameLocator(${esc(frameSel)})`;
  }

  // Handle `within` — evaluate parent first, then chain
  let locatorExpr: string;
  if (t.within) {
    // Pass rootExpr so the frame context is preserved when resolving within
    const withinExpr = compileTarget(t.within, warnings, stepIndex, rootExpr);
    locatorExpr = buildLocatorCall(t, withinExpr, warnings, stepIndex);
  } else {
    locatorExpr = buildLocatorCall(t, rootExpr, warnings, stepIndex);
  }

  // nth modifier
  if (t.nth !== undefined) {
    locatorExpr = `${locatorExpr}.nth(${t.nth})`;
  }

  return locatorExpr;
}

function buildLocatorCall(
  t: Target,
  base: string,
  warnings: CompileWarning[],
  stepIndex: number,
): string {
  switch (t.by) {
    case 'role': {
      const opts: string[] = [];
      if (t.name !== undefined) opts.push(`name: ${esc(t.name)}`);
      if (t.exact !== undefined) opts.push(`exact: ${t.exact}`);
      const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
      return `${base}.getByRole(${esc(t.role)}${optsStr})`;
    }
    case 'label': {
      const opts = t.exact !== undefined ? `, { exact: ${t.exact} }` : '';
      return `${base}.getByLabel(${esc(t.value)}${opts})`;
    }
    case 'placeholder': {
      const opts = t.exact !== undefined ? `, { exact: ${t.exact} }` : '';
      return `${base}.getByPlaceholder(${esc(t.value)}${opts})`;
    }
    case 'text': {
      const opts = t.exact !== undefined ? `, { exact: ${t.exact} }` : '';
      return `${base}.getByText(${esc(t.value)}${opts})`;
    }
    case 'altText': {
      const opts = t.exact !== undefined ? `, { exact: ${t.exact} }` : '';
      return `${base}.getByAltText(${esc(t.value)}${opts})`;
    }
    case 'title': {
      const opts = t.exact !== undefined ? `, { exact: ${t.exact} }` : '';
      return `${base}.getByTitle(${esc(t.value)}${opts})`;
    }
    case 'testId':
      return `${base}.getByTestId(${esc(t.value)})`;
    case 'css':
      warnings.push({
        stepIndex,
        message: `CSS selector used: ${t.value} — prefer getByRole/getByLabel/getByTestId for resilience`,
        severity: 'warn',
      });
      return `${base}.locator(${esc(t.value)})`;
    case 'xpath':
      warnings.push({
        stepIndex,
        message: `XPath selector used: ${t.value} — prefer getByRole/getByLabel/getByTestId for resilience`,
        severity: 'warn',
      });
      return `${base}.locator(${esc(t.value)})`;
    default: {
      // Exhaustiveness guard
      const _: never = t;
      return `${base}.locator('/* unknown target */')`;
    }
  }
}

// ── ValueRef compilation ──────────────────────────────────────────────────────

function compileValue(v: ValueRef): string {
  if ('literal' in v) return esc(v.literal);
  if ('var' in v) return `vars.${v.var}`;
  if ('secret' in v) return `process.env.SENTINEL_SECRET_${v.secret}!`;
  if ('faker' in v) {
    // e.g. "person.fullName" → faker.person.fullName()
    return `faker.${v.faker}()`;
  }
  if ('runToken' in v) return `run.${v.runToken}`;
  // Should be unreachable
  return `'/* unknown value */'`;
}

/**
 * Compile a ValueRef for a comparison whose subject is a number — a response
 * status, or an element count.
 *
 * `ValueRef.literal` is always a string and `compileValue` quotes it, so routing
 * those through `compileValue` emitted `toBe('204')`, which can never match the
 * number `response.status()` returns. Numeric literals are emitted bare; anything
 * dynamic (a var, a run token) is coerced at runtime, since its value isn't
 * known here.
 */
function compileNumericValue(v: ValueRef): string {
  if ('literal' in v) {
    const n = Number(v.literal);
    if (v.literal.trim() !== '' && Number.isFinite(n)) return String(n);
  }
  return `Number(${compileValue(v)})`;
}

// ── Assertion compilation ─────────────────────────────────────────────────────

function compileAssertion(
  a: Assertion,
  warnings: CompileWarning[],
  stepIndex: number,
  /**
   * Name of the in-scope variable holding the response an `on: 'response'`
   * assertion should read — the most recent request step's binding, or `null` if
   * no request has run yet in this scope.
   */
  responseVar: string | null,
): string {
  const not = 'not' in a && a.not ? '.not' : '';

  if (a.on === 'page') {
    const val = compileValue(a.expected);
    switch (a.is) {
      case 'url':
        return `await expect(page)${not}.toHaveURL(${val});`;
      case 'title':
        return `await expect(page)${not}.toHaveTitle(${val});`;
    }
  }

  if (a.on === 'response') {
    // Previously these emitted a bare `capturedRes`, which nothing in the
    // generated file ever declared — the test died with a ReferenceError instead
    // of asserting. Bind to the request step that actually produced a response,
    // and refuse to emit anything if there isn't one.
    if (responseVar === null) {
      warnings.push({
        stepIndex,
        message:
          'response assertion has no response in scope — it must follow an apiRequest, ' +
          'or a goto with expectStatus, in the same step group; assertion skipped',
        severity: 'warn',
      });
      return `// skipped: response assertion with no request in scope`;
    }
    const val = compileValue(a.expected);
    switch (a.is) {
      case 'status':
        return `expect(${responseVar}.status())${not}.toBe(${compileNumericValue(a.expected)});`;
      case 'ok':
        return `expect(${responseVar}.ok())${not}.toBe(true);`;
      case 'header':
        return `expect(${responseVar}.headers()[${esc(a.header ?? '')}])${not}.toBe(${val});`;
      case 'jsonPath':
        return `expect(await ${responseVar}.json())${not}.toMatchObject(${val});`;
    }
  }

  if (a.on === 'console') {
    switch (a.is) {
      case 'noErrors':
        return `// assertion: console has no errors`;
      case 'containsText': {
        const val = a.expected ? compileValue(a.expected) : `''`;
        return `// assertion: console contains text ${val}`;
      }
    }
  }

  if (a.on === 'network') {
    switch (a.is) {
      case 'noFailedRequests':
        return `// assertion: network has no failed requests`;
      case 'noStatusAtOrAbove': {
        const val = a.expected ? compileValue(a.expected) : `500`;
        return `// assertion: network no status at or above ${val}`;
      }
    }
  }

  // Target assertions
  if (typeof a.on === 'object') {
    const loc = compileTarget(a.on, warnings, stepIndex);
    switch (a.is) {
      case 'visible':
        return `await expect(${loc})${not}.toBeVisible();`;
      case 'hidden':
        return `await expect(${loc})${not}.toBeHidden();`;
      case 'enabled':
        return `await expect(${loc})${not}.toBeEnabled();`;
      case 'disabled':
        return `await expect(${loc})${not}.toBeDisabled();`;
      case 'checked':
        return `await expect(${loc})${not}.toBeChecked();`;
      case 'editable':
        return `await expect(${loc})${not}.toBeEditable();`;
      case 'focused':
        return `await expect(${loc})${not}.toBeFocused();`;
      case 'text': {
        const val = compileValue((a as { expected: ValueRef }).expected);
        return `await expect(${loc})${not}.toHaveText(${val});`;
      }
      case 'containsText': {
        const val = compileValue((a as { expected: ValueRef }).expected);
        return `await expect(${loc})${not}.toContainText(${val});`;
      }
      case 'value': {
        const val = compileValue((a as { expected: ValueRef }).expected);
        return `await expect(${loc})${not}.toHaveValue(${val});`;
      }
      case 'attribute': {
        const typed = a as { expected: ValueRef; attribute?: string };
        const val = compileValue(typed.expected);
        const attr = typed.attribute ?? '';
        return `await expect(${loc})${not}.toHaveAttribute(${esc(attr)}, ${val});`;
      }
      case 'class': {
        const val = compileValue((a as { expected: ValueRef }).expected);
        return `await expect(${loc})${not}.toHaveClass(${val});`;
      }
      case 'count': {
        const val = compileNumericValue((a as { expected: ValueRef }).expected);
        return `await expect(${loc})${not}.toHaveCount(${val});`;
      }
      case 'screenshotMatches': {
        const typed = a as { name: string; maxDiffPixelRatio?: number };
        const opts = typed.maxDiffPixelRatio !== undefined
          ? `, { maxDiffPixelRatio: ${typed.maxDiffPixelRatio} }`
          : '';
        return `await expect(${loc})${not}.toMatchSnapshot(${esc(typed.name)}${opts});`;
      }
    }
  }

  return `// TODO: unhandled assertion`;
}

// ── Step compilation ──────────────────────────────────────────────────────────

/**
 * Tracks the variable holding the most recent response, so a following
 * `on: 'response'` assertion has something real to read.
 *
 * Mutable and shared across the step loop because it is sequential state: each
 * request step overwrites it. Groups compile into a `test.step` callback, so a
 * binding made inside one goes out of scope at its end — `compileStep` restores
 * the previous value after a group for exactly that reason.
 */
interface ResponseScope {
  lastVar: string | null;
}

function compileStep(
  step: Step,
  stepIndex: number,
  warnings: CompileWarning[],
  resp: ResponseScope,
  indent = '  ',
): string {
  switch (step.kind) {
    case 'goto': {
      if (step.expectStatus !== undefined) {
        resp.lastVar = `_res${stepIndex}!`;
        return (
          `${indent}const _res${stepIndex} = await page.goto(${esc(step.url)}` +
          (step.waitUntil ? `, { waitUntil: ${esc(step.waitUntil)} }` : '') +
          `);\n` +
          `${indent}expect(_res${stepIndex}!.status()).toBe(${step.expectStatus});`
        );
      }
      const opts = step.waitUntil ? `, { waitUntil: ${esc(step.waitUntil)} }` : '';
      return `${indent}await page.goto(${esc(step.url)}${opts});`;
    }

    case 'click': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const opts: string[] = [];
      if (step.button) opts.push(`button: ${esc(step.button)}`);
      if (step.clickCount !== undefined) opts.push(`clickCount: ${step.clickCount}`);
      const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
      return `${indent}await ${loc}.click(${optsStr});`;
    }

    case 'fill': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const val = compileValue(step.value);
      return `${indent}await ${loc}.fill(${val});`;
    }

    case 'type': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const val = compileValue(step.value);
      const opts = step.delayMs !== undefined ? `, { delay: ${step.delayMs} }` : '';
      return `${indent}await ${loc}.pressSequentially(${val}${opts});`;
    }

    case 'press': {
      const target = step.target
        ? compileTarget(step.target, warnings, stepIndex)
        : 'page';
      return `${indent}await ${target}.press(${esc(step.key)});`;
    }

    case 'select': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const vals = step.values.map(compileValue).join(', ');
      return `${indent}await ${loc}.selectOption([${vals}]);`;
    }

    case 'check': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      return step.checked
        ? `${indent}await ${loc}.check();`
        : `${indent}await ${loc}.uncheck();`;
    }

    case 'upload': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const files = step.files.map(esc).join(', ');
      return `${indent}await ${loc}.setInputFiles([${files}]);`;
    }

    case 'hover': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      return `${indent}await ${loc}.hover();`;
    }

    case 'scrollTo': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      return `${indent}await ${loc}.scrollIntoViewIfNeeded();`;
    }

    case 'waitFor': {
      const loc = compileTarget(step.target, warnings, stepIndex);
      const opts: string[] = [`state: ${esc(step.state)}`];
      if (step.timeoutMs !== undefined) opts.push(`timeout: ${step.timeoutMs}`);
      return `${indent}await ${loc}.waitFor({ ${opts.join(', ')} });`;
    }

    case 'expect': {
      const assertCode = compileAssertion(step.assertion, warnings, stepIndex, resp.lastVar);
      return `${indent}${assertCode}`;
    }

    case 'screenshot': {
      const opts: string[] = [`path: \`artifacts/${step.name}.png\``];
      if (step.fullPage) opts.push(`fullPage: true`);
      return `${indent}await page.screenshot({ ${opts.join(', ')} });`;
    }

    case 'apiRequest': {
      const methodStr = esc(step.method.toUpperCase());
      const urlStr = esc(step.url);
      const bodyStr = step.body !== undefined ? `, data: ${JSON.stringify(step.body)}` : '';
      const varName = step.saveAs ?? `_apiResp${stepIndex}`;
      resp.lastVar = varName;
      return `${indent}const ${varName} = await page.request.fetch(${urlStr}, { method: ${methodStr}${bodyStr} });`;
    }

    case 'pollApi': {
      const methodStr = esc(step.method.toUpperCase());
      const urlStr = esc(step.url);
      const timeoutOpt = step.timeoutMs !== undefined ? `, { timeout: ${step.timeoutMs}, intervals: [${step.intervalMs ?? 1000}] }` : '';
      // Compile the until assertion inline, bound to the response the poll
      // callback fetches on each iteration.
      const untilCode = compileAssertion(step.until, warnings, stepIndex, 'r').trim();
      return (
        // expect.poll needs a callback returning a value to match on, but an
        // assertion reports failure by throwing — so the callback runs `until`
        // and reports whether it held, and the poll retries until it does.
        // Without this the step polled for a bare 200 and silently ignored
        // whatever the test actually asked it to wait for.
        `${indent}await expect.poll(async () => {\n` +
        `${indent}  const r = await page.request.fetch(${urlStr}, { method: ${methodStr} });\n` +
        `${indent}  try {\n` +
        `${indent}    ${untilCode}\n` +
        `${indent}    return true;\n` +
        `${indent}  } catch {\n` +
        `${indent}    return false;\n` +
        `${indent}  }\n` +
        `${indent}}${timeoutOpt}).toBe(true);`
      );
    }

    case 'waitForInbox': {
      const to = compileValue(step.to);
      const opts: string[] = [`to: ${to}`];
      if (step.subjectContains) opts.push(`subjectContains: ${esc(step.subjectContains)}`);
      if (step.timeoutMs !== undefined) opts.push(`timeoutMs: ${step.timeoutMs}`);
      const varName = step.saveAs ?? `_inbox${stepIndex}`;
      return (
        `${indent}// waitForInbox: provider=${step.provider}\n` +
        `${indent}const ${varName} = await waitForInbox(${esc(step.provider)}, { ${opts.join(', ')} });`
      );
    }

    case 'waitForCapture': {
      const opts: string[] = [];
      if (step.matchBody) opts.push(`match: ${JSON.stringify(step.matchBody)}`);
      if (step.timeoutMs !== undefined) opts.push(`timeoutMs: ${step.timeoutMs}`);
      const varName = step.saveAs ?? `_capture${stepIndex}`;
      const optsStr = opts.length ? `{ ${opts.join(', ')} }` : '{}';
      return `${indent}const ${varName} = await capture.events(${optsStr});`;
    }

    case 'group': {
      const outerResponseVar = resp.lastVar;
      const inner = step.steps
        .map((s, i) => compileStep(s, stepIndex * 1000 + i, warnings, resp, indent + '  '))
        .join('\n');
      // Anything the group bound lives inside the `test.step` callback and is out
      // of scope from here on.
      resp.lastVar = outerResponseVar;
      return (
        `${indent}await test.step(${esc(step.title)}, async () => {\n` +
        `${inner}\n` +
        `${indent}});`
      );
    }

    case 'comment':
      return `${indent}// ${step.text}`;

    case 'raw': {
      warnings.push({
        stepIndex,
        message: 'raw step — test marked as hybrid',
        severity: 'warn',
      });
      // Indent each line of the raw code
      const indented = step.code
        .split('\n')
        .map((l) => `${indent}${l}`)
        .join('\n');
      return indented;
    }

    default: {
      const _: never = step;
      return `${indent}// TODO: unhandled step kind`;
    }
  }
}

// ── File header ───────────────────────────────────────────────────────────────

const FILE_HEADER = `import { test, expect } from '../fixtures/sentinel';

test('TODO — add test title', async ({ page, vars, secrets, run, capture }) => {`;

const FILE_FOOTER = `});`;

// ── Main compile function ─────────────────────────────────────────────────────

export async function compile(ir: StepIr): Promise<CompileResult> {
  const warnings: CompileWarning[] = [];

  const resp: ResponseScope = { lastVar: null };

  const stepLines = ir.steps.map((step, idx) => compileStep(step, idx, warnings, resp)).join('\n');

  const rawCode = `${FILE_HEADER}\n${stepLines}\n${FILE_FOOTER}\n`;

  const code = await prettier.format(rawCode, {
    parser: 'typescript',
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    bracketSpacing: true,
    arrowParens: 'always',
    endOfLine: 'lf',
  });

  return { code, warnings };
}
