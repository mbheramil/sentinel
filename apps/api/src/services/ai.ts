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
import { StepIrSchema, compile } from '@sentinel/ir';
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

async function extractAccessibilityTree(rawUrl: string, maxChars = 32_000): Promise<string> {
  const parsed = assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let html: string;
  try {
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Sentinel-TestGen/1.0 (accessibility-tree-extractor)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const lines: string[] = [];

  const push = (line: string) => {
    if (lines.length < 2000) lines.push(line.trim());
  };

  // Strip scripts and styles to reduce noise
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Headings
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = m[2]!.replace(/<[^>]+>/g, '').trim();
    if (text) push(`heading level=${m[1]}: "${text}"`);
  }

  // Buttons
  for (const m of html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)) {
    const text = m[1]!.replace(/<[^>]+>/g, '').trim();
    const ariaLabel = m[0].match(/aria-label="([^"]+)"/i)?.[1];
    if (text || ariaLabel) push(`button: "${ariaLabel ?? text}"`);
  }

  // Links
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2]!.replace(/<[^>]+>/g, '').trim();
    if (text) push(`link href="${m[1]}": "${text}"`);
  }

  // Inputs
  for (const m of html.matchAll(/<input([^>]*)>/gi)) {
    const attrs = m[1]!;
    const type = attrs.match(/type="([^"]+)"/i)?.[1] ?? 'text';
    const name = attrs.match(/name="([^"]+)"/i)?.[1] ?? '';
    const placeholder = attrs.match(/placeholder="([^"]+)"/i)?.[1] ?? '';
    const ariaLabel = attrs.match(/aria-label="([^"]+)"/i)?.[1] ?? '';
    const id = attrs.match(/id="([^"]+)"/i)?.[1] ?? '';
    if (type === 'hidden') continue;
    push(`input[type="${type}"]${name ? ` name="${name}"` : ''}${id ? ` id="${id}"` : ''}${placeholder ? ` placeholder="${placeholder}"` : ''}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}`);
  }

  // Textareas
  for (const m of html.matchAll(/<textarea([^>]*)>/gi)) {
    const attrs = m[1]!;
    const name = attrs.match(/name="([^"]+)"/i)?.[1] ?? '';
    const ariaLabel = attrs.match(/aria-label="([^"]+)"/i)?.[1] ?? '';
    push(`textarea${name ? ` name="${name}"` : ''}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}`);
  }

  // Selects
  for (const m of html.matchAll(/<select([^>]*)>/gi)) {
    const attrs = m[1]!;
    const name = attrs.match(/name="([^"]+)"/i)?.[1] ?? '';
    const ariaLabel = attrs.match(/aria-label="([^"]+)"/i)?.[1] ?? '';
    push(`select${name ? ` name="${name}"` : ''}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}`);
  }

  // Labels
  for (const m of html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)) {
    const text = m[1]!.replace(/<[^>]+>/g, '').trim();
    if (text) push(`label: "${text}"`);
  }

  // Main landmarks
  for (const m of html.matchAll(/<(main|nav|header|footer|section|article)[^>]*aria-label="([^"]+)"/gi)) {
    push(`${m[1]} role, aria-label="${m[2]}"`);
  }

  const result = lines.join('\n');
  return result.length > maxChars ? result.slice(0, maxChars) + '\n... (truncated)' : result;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const STEP_IR_SCHEMA_SUMMARY = `
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

const GENERATE_SYSTEM_PROMPT = `You are an expert Playwright test author. Generate a test in Step IR JSON format.

${STEP_IR_SCHEMA_SUMMARY}

RULES:
1. ONLY use step kinds from the schema above. NEVER invent new kinds like "verify", "navigate",
   "assert", "input", "submit", "check_title", etc. Invalid kinds cause a hard error.
2. Prefer role-based locators (by:"role") over css/xpath.
3. Use by:"label" for form inputs linked to a <label>.
4. Always start with a goto step. Use a RELATIVE path like "/" or "/contact/" — NOT the full URL.
   The environment's baseURL is already set to the site domain.
5. Use group steps to organise related actions (e.g. "Fill form", "Verify result").
6. Add expect steps to verify important state after interactions.
7. Keep secrets out of literal values — use { "secret": "..." } instead.
8. The test function signature is: async ({ page, vars, secrets, run }) — do NOT add "capture".
9. Do NOT include a submit/click-submit step unless the user explicitly says to submit.
   For form tests: fill fields and assert the submit button is enabled, then stop.

RESPONSE FORMAT (output ONLY this JSON, no prose, no code blocks):
{
  "ir": { "version": 1, "steps": [...] },
  "explanation": "Brief plain-English explanation of what this test does."
}`;

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

  // Parse JSON — strip any accidental markdown fences
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw Object.assign(
      new Error(`AI response is not valid JSON: ${(e as Error).message}`),
      { statusCode: 502 },
    );
  }

  // Expect wrapper { ir: StepIr, explanation: string }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('ir' in parsed) ||
    !('explanation' in parsed)
  ) {
    throw Object.assign(
      new Error('AI response does not match expected shape { ir, explanation }'),
      { statusCode: 502 },
    );
  }

  const wrapper = parsed as { ir: unknown; explanation: unknown };

  // Validate the IR — this is the security boundary (§8.3)
  const irResult = StepIrSchema.safeParse(wrapper.ir);
  if (!irResult.success) {
    const issues = irResult.error.errors
      .slice(0, 5)
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw Object.assign(
      new Error(`AI-generated IR failed schema validation: ${issues}`),
      { statusCode: 502 },
    );
  }
  const stepsIr = irResult.data;

  // Compile IR → code through the trusted compiler
  const { code } = await compile(stepsIr);

  const explanation =
    typeof wrapper.explanation === 'string' ? wrapper.explanation : 'AI-generated test.';

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
