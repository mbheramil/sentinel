import { createInterface } from 'readline';
import type { Readable } from 'stream';
import { SentinelEventSchema, SENTINEL_REPORTER_MARKER } from '@sentinel/shared';
import type { SentinelEvent } from '@sentinel/shared';
import { logger } from './logger.js';

const BATCH_DEBOUNCE_MS = 250;
const MARKER_PREFIX = SENTINEL_REPORTER_MARKER + ' ';

// ── Secret scrubber ───────────────────────────────────────────────────────────
// Scrubs raw, base64, and URL-encoded forms of each secret value.

const MIN_SECRET_LENGTH = 4;

export function buildScrubber(
  secrets: Record<string, string>,
): (s: string) => string {
  const replacements: Array<[RegExp, string]> = [];

  for (const raw of Object.values(secrets)) {
    if (raw.length < MIN_SECRET_LENGTH) continue;

    const forms = new Set<string>([
      raw,
      Buffer.from(raw).toString('base64'),
      encodeURIComponent(raw),
    ]);

    for (const form of forms) {
      // Escape for regex
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      replacements.push([new RegExp(escaped, 'g'), '***']);
    }
  }

  if (replacements.length === 0) return (s) => s;

  return (s: string) => {
    for (const [pattern, replacement] of replacements) {
      s = s.replace(pattern, replacement);
    }
    return s;
  };
}

// ── Batch flusher ─────────────────────────────────────────────────────────────

async function flushBatch(
  batch: SentinelEvent[],
  runId: string,
  apiUrl: string,
  runnerToken: string,
  scrub: (s: string) => string,
): Promise<void> {
  if (batch.length === 0) return;

  // Scrub secrets from each event before sending
  const ndjson = batch
    .map((ev) => scrub(JSON.stringify(ev)))
    .join('\n');

  const url = `${apiUrl}/internal/runs/${runId}/events`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'x-runner-token': runnerToken,
      },
      body: ndjson,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      logger.warn(
        { status: res.status, runId, url, text },
        'Event batch POST returned non-2xx',
      );
    }
  } catch (err) {
    logger.warn({ err, runId, url }, 'Event batch POST failed');
  }
}

// ── Main parser ───────────────────────────────────────────────────────────────

export async function parseAndForwardEvents(
  stdout: Readable,
  runId: string,
  shardIndex: number,
  apiUrl: string,
  runnerToken: string,
  secrets: Record<string, string> = {},
): Promise<SentinelEvent[]> {
  const scrub = buildScrubber(secrets);
  const allEvents: SentinelEvent[] = [];
  let pendingBatch: SentinelEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      const batch = pendingBatch;
      pendingBatch = [];
      await flushBatch(batch, runId, apiUrl, runnerToken, scrub);
    }, BATCH_DEBOUNCE_MS);
  };

  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.startsWith(MARKER_PREFIX)) continue;

    const jsonPart = line.slice(MARKER_PREFIX.length);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      logger.debug({ line }, 'Failed to parse sentinel event JSON');
      continue;
    }

    const result = SentinelEventSchema.safeParse(parsed);
    if (!result.success) {
      logger.debug(
        { issues: result.error.issues, line },
        'Sentinel event failed schema validation',
      );
      continue;
    }

    const event = result.data;

    // Override shardIndex from the authoritative runner value (not trusting
    // the reporter's self-reported value)
    const normalised = { ...event, shardIndex } as SentinelEvent;
    allEvents.push(normalised);
    pendingBatch.push(normalised);
    scheduleFlush();
  }

  // Flush any remaining events after stream ends
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushBatch(pendingBatch, runId, apiUrl, runnerToken, scrub);
  pendingBatch = [];

  return allEvents;
}
