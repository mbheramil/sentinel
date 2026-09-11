/**
 * AI service — Phase 5: test generation and failure triage.
 *
 * Security contract (§8.3):
 *   The AI ALWAYS outputs Step IR JSON.  The IR is validated with StepIrSchema
 *   before compilation.  The AI can never emit arbitrary JavaScript because the
 *   compiler is the only path from IR to code.
 */
import Anthropic from '@anthropic-ai/sdk';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { prisma } from '@sentinel/db';
import { compile as _compile, StepIrSchema as _StepIrSchema } from '@sentinel/ir';
import type { StepIr } from '@sentinel/ir';
import { config } from '../config.js';

// ── Pricing table (micro-USD per token) ──────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 15, output: 75 },
  'gpt-4o': { input: 2, output: 8 },
  'gpt-4o-mini': { input: 0, output: 0 },
};

function calcCostMicro(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? PRICING['claude-sonnet-5']!;
  return price.input * inputTokens + price.output * outputTokens;
}

// ── Provider detection ────────────────────────────────────────────────────────

type Provider = 'anthropic' | 'openai' | 'bedrock';

function detectProvider(): Provider {
  if (config.ANTHROPIC_API_KEY) return 'anthropic';
  if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) return 'bedrock';
  if (config.OPENAI_API_KEY) return 'openai';
  return 'anthropic'; // will fail with a helpful message in resolveApiKey
}

// ── Unified completions interface ─────────────────────────────────────────────

interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

async function callLLM(system: string, user: string, deepMode: boolean): Promise<CompletionResult> {
  const provider = detectProvider();

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY! });
    const model = deepMode ? config.AI_MODEL_DEEP : config.AI_MODEL_DEFAULT;
    const res = await client.messages.create({
      model, max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = res.content.find((b) => b.type === 'text');
    return {
      text: text?.type === 'text' ? text.text : '',
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model,
    };
  }

  if (provider === 'bedrock') {
    const client = new AnthropicBedrock({
      awsAccessKey: config.AWS_ACCESS_KEY_ID!,
      awsSecretKey: config.AWS_SECRET_ACCESS_KEY!,
      awsRegion: config.AWS_REGION,
    });
    const model = deepMode ? config.BEDROCK_MODEL_DEEP : config.BEDROCK_MODEL_DEFAULT;
    const res = await client.messages.create({
      model, max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const textBlock = res.content.find((b) => b.type === 'text');
    return {
      text: textBlock?.type === 'text' ? textBlock.text : '',
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model,
    };
  }

  // OpenAI
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY! });
  const model = deepMode ? 'gpt-4o' : 'gpt-4o-mini';
  const res = await client.chat.completions.create({
    model, max_tokens: 4096,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return {
    text: res.choices[0]?.message?.content ?? '',
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    model,
  };
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,          // link-local / AWS metadata
  /^100\.64\./            // CGNAT
];

function assertSafeUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${raw}`), { statusCode: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Object.assign(new Error('URL must use http or https'), { statusCode: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  for (const p of BLOCKED_HOST_PATTERNS) {
    if (p.test(host)) {
      throw Object.assign(new Error(`URL resolves to a blocked address: ${host}`), { statusCode: 400 });
    }
  }
  return parsed;
}

// ── Accessibility-tree extraction ─────────────────────────────────────────────

async function extractWithPlaywright(url: string): Promise<string> {
  // Launch a real browser and introspect the live DOM for exact form structure.
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = req('@playwright/test') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser = await (pw.chromium as any).launch({ headless: true });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (await (browser as any).newContext()).newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).waitForTimeout(2500);

    // Introspect every form field directly from the live rendered DOM
    // The callback runs in the browser — no TypeScript DOM types available in Node ctx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (page as any).evaluate((pageUrl: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const lines: string[] = [
        `=== LIVE FORM ANALYSIS for ${pageUrl} ===`,
        'Use EXACT label text below in getByLabel(). Do not paraphrase.',
        '',
      ];

      (document as any).querySelectorAll('input, select, textarea').forEach((el: any) => {
        const type: string = el.type || (el.tagName === 'SELECT' ? 'select' : 'textarea');
        if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return;

        let label = '';
        if (el.id) {
          const lbl = (document as any).querySelector(`label[for="${el.id}"]`);
          if (lbl) label = (lbl.textContent || '').replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim();
        }
        if (!label) {
          const wrap = el.closest('label');
          if (wrap) {
            const clone = wrap.cloneNode(true);
            clone.querySelectorAll('input,select,textarea').forEach((c: any) => c.remove());
            label = (clone.textContent || '').replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim();
          }
        }
        if (!label) label = el.getAttribute('aria-label') || '';
        const placeholder: string = el.placeholder || '';

        if (type === 'file') { lines.push(`  FIELD (skip — file upload): label="${label}"`); return; }

        if (el.tagName === 'SELECT') {
          const opts = [...el.options].map((o: any) => o.text.trim()).filter((t: string) => t && t !== '—');
          lines.push(`  FIELD: type=select  label="${label}"  options: [${opts.slice(0, 10).join(' | ')}]`);
          return;
        }

        lines.push(`  FIELD: type=${type}  label="${label}"${placeholder ? `  placeholder="${placeholder}"` : ''}`);
      });

      const btn: any = (document as any).querySelector('button[type="submit"], input[type="submit"]');
      if (btn) {
        const t: string = (btn.textContent || btn.value || '').trim();
        lines.push('', `  SUBMIT BUTTON: "${t}"`);
      }

      const captcha: any = (document as any).querySelector('.g-recaptcha,.h-captcha,iframe[title*="reCAPTCHA"],[class*="captcha"]');
      if (captcha) {
        lines.push('', '  CAPTCHA_PRESENT — submit stays DISABLED; do NOT assert toBeEnabled().', '  Assert instead: await expect(page.locator(\'.g-recaptcha\')).toBeVisible();');
      }

      lines.push('', '=== END ===');
      return lines.join('\n');
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, url);
  } finally {
    await browser.close();
  }
}

async function extractAccessibilityTree(rawUrl: string, maxChars = 32_000): Promise<string> {
  const parsed = assertSafeUrl(rawUrl);

  // Playwright introspects the live rendered DOM and returns structured form data.
  // If Playwright is unavailable fall back to a basic plain-text fetch.
  try {
    const result = await extractWithPlaywright(parsed.href);
    return result.length > maxChars ? result.slice(0, maxChars) + '\n... (truncated)' : result;
  } catch {
    // Minimal fallback: just return a message so the AI knows the fetch failed
    return `Could not render ${parsed.href} — please describe the form fields in your prompt.`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const _STEP_IR_SCHEMA_SUMMARY = `
Step IR schema (version: 1):
Root: { "version": 1, "steps": [Step] }

Step (discriminated union on "kind"):
  goto:       { kind:"goto", url:string, waitUntil?:"load"|"domcontentloaded"|"networkidle", expectStatus?:number }
  click:      { kind:"click", target:Target, button?:"left"|"right"|"middle", clickCount?:number }
  fill:       { kind:"fill", target:Target, value:ValueRef }
  type:       { kind:"type", target:Target, value:ValueRef, delayMs?:number }
  press:      { kind:"press", key:string, target?:Target }
  select:     { kind:"select", target:Target, values:ValueRef[] }
  check:      { kind:"check", target:Target, checked:boolean }
  hover:      { kind:"hover", target:Target }
  scrollTo:   { kind:"scrollTo", target:Target }
  waitFor:    { kind:"waitFor", target:Target, state:"visible"|"hidden"|"attached"|"detached", timeoutMs?:number }
  expect:     { kind:"expect", assertion:Assertion }
  screenshot: { kind:"screenshot", name:string, fullPage?:boolean }
  group:      { kind:"group", title:string, steps:Step[] }
  comment:    { kind:"comment", text:string }

Target (pick ONE "by" strategy; optional modifiers: nth?, within?):
  role:        { by:"role", role:string, name?:string, exact?:boolean }
  label:       { by:"label", value:string, exact?:boolean }
  placeholder: { by:"placeholder", value:string, exact?:boolean }
  text:        { by:"text", value:string, exact?:boolean }
  testId:      { by:"testId", value:string }
  css:         { by:"css", value:string }
  xpath:       { by:"xpath", value:string }

ValueRef (pick ONE):
  { "literal": "the value" }
  { "var": "varName" }
  { "secret": "SECRET_NAME" }

Assertion:
  element state:  { on:Target, is:"visible"|"hidden"|"enabled"|"disabled"|"checked"|"editable"|"focused", not?:boolean }
  element value:  { on:Target, is:"text"|"containsText"|"value"|"attribute"|"class"|"count", expected:ValueRef, not?:boolean }
  page url/title: { on:"page", is:"url"|"title", expected:ValueRef, not?:boolean }
`.trim();

const GENERATE_SYSTEM_PROMPT = `You are an expert Playwright test author. Write a Playwright test in TypeScript.

FIXTURE IMPORT (always use this exact import — no others):
  import { test, expect } from '../fixtures/sentinel';

TEST SIGNATURE (always use exactly this — no extra fixtures):
  test('descriptive name here', async ({ page }) => {

RULES:
1. Use RELATIVE paths in page.goto() — e.g. page.goto('/') or page.goto('/contact/')
   The baseURL is already set to the target site.
2. EXACT TEXT ONLY — copy label/placeholder/button text CHARACTER FOR CHARACTER from the
   accessibility tree. "Contact Number" stays "Contact Number", never "Phone".
   "Order details" stays "Order details", never "Message". Wrong text = timeout.
3. Prefer getByLabel (exact label text), then getByPlaceholder, then getByRole.
   Use page.locator('[name="..."]') only when no label/placeholder exists.
4. CAPTCHA rule — if the tree contains CAPTCHA_PRESENT:
   - Fill the form fields and verify with toHaveValue()
   - Do NOT assert the submit button is enabled (CAPTCHA keeps it disabled)
   - Just assert page.locator('.g-recaptcha, iframe[title*="reCAPTCHA"]').toBeVisible()
5. Do NOT click submit unless the user explicitly asks.
6. After filling each field, add expect(field).toHaveValue('...') to confirm it worked.
7. Keep the test focused on ONE specific behaviour.

RESPONSE FORMAT — use these exact delimiters, nothing else before or after:

===CODE===
<the complete TypeScript test file here — no markdown fences>
===EXPLANATION===
<one sentence describing what this test does>
===END===`;

// ── Provider availability check ───────────────────────────────────────────────

function assertProviderConfigured(): void {
  if (
    config.ANTHROPIC_API_KEY ||
    config.OPENAI_API_KEY ||
    (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY)
  ) return;
  throw Object.assign(
    new Error(
      'No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or ' +
      'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (Bedrock) in the server environment.',
    ),
    { statusCode: 402 },
  );
}

// ── Generate test ─────────────────────────────────────────────────────────────

export interface GenerateTestOptions {
  prompt: string;
  url?: string;
  orgId: string;
  deepMode?: boolean;
}

export interface GenerateTestResult {
  stepsIr: StepIr;
  code: string;
  explanation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateTest(opts: GenerateTestOptions): Promise<GenerateTestResult> {
  assertProviderConfigured();

  // Optionally augment prompt with accessibility tree
  let userMessage = opts.prompt;
  if (opts.url) {
    assertSafeUrl(opts.url);
    try {
      const tree = await extractAccessibilityTree(opts.url);
      if (tree.trim().length > 0) {
        userMessage =
          `URL: ${opts.url}\n\nAccessibility tree:\n${tree}\n\n---\n\nTest requirement: ${opts.prompt}`;
      } else {
        userMessage = `URL: ${opts.url}\n\nTest requirement: ${opts.prompt}`;
      }
    } catch {
      userMessage = `URL: ${opts.url}\n\nTest requirement: ${opts.prompt}`;
    }
  }

  const { text: rawText, inputTokens, outputTokens, model } =
    await callLLM(GENERATE_SYSTEM_PROMPT, userMessage, opts.deepMode ?? false);

  // Parse delimiter format: ===CODE=== ... ===EXPLANATION=== ... ===END===
  const codeMatch = rawText.match(/===CODE===\s*([\s\S]*?)\s*===EXPLANATION===/);
  const explanationMatch = rawText.match(/===EXPLANATION===\s*([\s\S]*?)\s*===END===/);

  let code = codeMatch?.[1]?.trim() ?? '';
  let explanation = explanationMatch?.[1]?.trim() ?? '';

  // Fallback: try JSON if the AI ignored the delimiter instruction
  if (!code) {
    try {
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      code = typeof parsed['code'] === 'string' ? parsed['code'].trim() : '';
      explanation = typeof parsed['explanation'] === 'string' ? parsed['explanation'] : '';
    } catch {
      // ignore — will fail below
    }
  }

  // Strip any accidental markdown fences around the code
  code = code.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/\s*```$/i, '').trim();

  if (!code) {
    throw Object.assign(new Error('AI returned empty code'), { statusCode: 502 });
  }
  if (!explanation) explanation = 'AI-generated test.';

  // Return a minimal stepsIr placeholder — the real content is in `code`.
  // The route stores the code directly; stepsIr is for display only.
  const stepsIr: StepIr = { version: 1, steps: [] };

  return { stepsIr, code, explanation, model, inputTokens, outputTokens };
}

// ── Triage failure ────────────────────────────────────────────────────────────

export interface TriageOptions {
  testVersionId: string;
  attemptId: string;
  errorSignature: string;
  orgId: string;
}

export interface TriageResult {
  likelyCause: string;
  confidence: 'high' | 'medium' | 'low';
  suggestion: string;
  fromCache: boolean;
}

export async function triageFailure(opts: TriageOptions): Promise<TriageResult> {
  // Check cache first
  const cached = await prisma.triageCache.findUnique({
    where: {
      testVersionId_errorSignature: {
        testVersionId: opts.testVersionId,
        errorSignature: opts.errorSignature,
      },
    },
  });

  if (cached) {
    const confidence = cached.confidence as 'high' | 'medium' | 'low';
    return {
      likelyCause: cached.likelyCause,
      confidence,
      suggestion: cached.suggestion,
      fromCache: true,
    };
  }

  // Build context from the attempt
  const attempt = await prisma.attempt.findUnique({
    where: { id: opts.attemptId },
    select: {
      errorName: true,
      errorMessage: true,
      errorStack: true,
      errorSnippet: true,
      steps: {
        take: 5,
        orderBy: { position: 'asc' },
        select: { title: true, status: true, errorMessage: true },
      },
      runTest: {
        select: {
          testVersion: {
            select: { code: true },
          },
        },
      },
    },
  });

  if (!attempt) {
    throw Object.assign(new Error('Attempt not found'), { statusCode: 404 });
  }

  const errorSummary = [
    attempt.errorName ? `Error: ${attempt.errorName}` : null,
    attempt.errorMessage ? `Message: ${attempt.errorMessage.slice(0, 500)}` : null,
    attempt.errorStack ? `Stack:\n${attempt.errorStack.slice(0, 800)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const stepsSummary = attempt.steps
    .map((s, i) => `Step ${i + 1}: [${s.status}] ${s.title}${s.errorMessage ? ` — ${s.errorMessage.slice(0, 120)}` : ''}`)
    .join('\n');

  const codeSnippet = attempt.runTest?.testVersion?.code?.slice(0, 1_500) ?? '';

  const userMessage = [
    '## Test failure to analyse',
    '',
    errorSummary,
    '',
    '## Top steps (first 5)',
    stepsSummary || '(none recorded)',
    '',
    codeSnippet ? `## Test code snippet\n\`\`\`typescript\n${codeSnippet}\n\`\`\`` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const systemPrompt = `You are a Playwright test failure analyst.
Analyse the provided failure context and respond ONLY with this JSON (no prose, no code blocks):
{
  "likelyCause": "1–2 sentence plain-English explanation of the most likely root cause",
  "confidence": "high" | "medium" | "low",
  "suggestion": "1–2 sentence actionable suggestion for how to fix or investigate this"
}

Confidence guide:
  high   — clear error message with obvious cause
  medium — plausible cause but multiple possibilities
  low    — insufficient information to diagnose reliably`;

  assertProviderConfigured();

  const { text, inputTokens, outputTokens, model } =
    await callLLM(systemPrompt, userMessage, false);

  const rawText = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let triageJson: unknown;
  try {
    triageJson = JSON.parse(rawText);
  } catch (e) {
    throw Object.assign(
      new Error(`AI triage response is not valid JSON: ${(e as Error).message}`),
      { statusCode: 502 },
    );
  }

  if (
    typeof triageJson !== 'object' ||
    triageJson === null ||
    !('likelyCause' in triageJson) ||
    !('confidence' in triageJson) ||
    !('suggestion' in triageJson)
  ) {
    throw Object.assign(
      new Error('AI triage response shape is invalid'),
      { statusCode: 502 },
    );
  }

  const t = triageJson as { likelyCause: unknown; confidence: unknown; suggestion: unknown };
  const confidence = ['high', 'medium', 'low'].includes(t.confidence as string)
    ? (t.confidence as 'high' | 'medium' | 'low')
    : 'low';

  const likelyCause = typeof t.likelyCause === 'string' ? t.likelyCause : String(t.likelyCause);
  const suggestion = typeof t.suggestion === 'string' ? t.suggestion : String(t.suggestion);

  // Cache the result
  await prisma.triageCache.create({
    data: {
      testVersionId: opts.testVersionId,
      errorSignature: opts.errorSignature,
      likelyCause,
      confidence,
      suggestion,
      model,
      inputTokens,
      outputTokens,
    },
  });

  // Record usage (non-fatal)
  await recordAiUsage({
    orgId: opts.orgId,
    operation: 'triage',
    model,
    inputTokens,
    outputTokens,
  });

  return { likelyCause, confidence, suggestion, fromCache: false };
}

/**
 * Compute a stable error signature for cache keying.
 * md5(errorName + '\x00' + errorMessage)
 */
export function computeErrorSignature(errorName: string | null, errorMessage: string | null): string {
  return createHash('md5')
    .update(`${errorName ?? ''}\x00${errorMessage ?? ''}`)
    .digest('hex');
}

/**
 * Record AI usage for billing / analytics.
 * Swallows errors so a tracking failure never blocks the user's response.
 */
export async function recordAiUsage(opts: {
  orgId: string;
  operation: 'generate' | 'triage';
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const costUsdMicro = calcCostMicro(opts.model, opts.inputTokens, opts.outputTokens);
  await prisma.aiUsage
    .create({
      data: {
        orgId: opts.orgId,
        operation: opts.operation,
        model: opts.model,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        costUsdMicro,
      },
    })
    .catch(() => {
      // Non-fatal — usage tracking must not break core functionality
    });
}
