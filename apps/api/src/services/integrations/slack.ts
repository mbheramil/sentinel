import { createHmac } from 'node:crypto';
import { logger } from '../../logger.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SlackConfig {
  webhookUrl: string;
  signingSecret?: string;
}

export interface FailedTest {
  name: string;
  browser: string;
  error: string;
  stepTitle?: string;
  finalUrl?: string;
}

export interface TopDiagnostics {
  consoleErrors: unknown[];
  networkErrors: unknown[];
}

export interface SlackNotificationPayload {
  event: string;
  projectName: string;
  runId: string;
  sentinelPublicUrl: string;
  failedTests: FailedTest[];
  topDiagnostics: TopDiagnostics;
  screenshotUrl?: string;
  totalFailed: number;
  durationMs?: number | null;
  attempt?: number;
  totalAttempts?: number;
}

// ─── Block Kit builder ──────────────────────────────────────────────────────

function buildBlocks(payload: SlackNotificationPayload): unknown[] {
  const {
    event,
    projectName,
    runId,
    sentinelPublicUrl,
    failedTests,
    topDiagnostics,
    totalFailed,
    durationMs,
    attempt,
    totalAttempts,
  } = payload;

  const runUrl = `${sentinelPublicUrl}/runs/${runId}`;
  const emoji = event === 'run.failed' ? '🔴' : event === 'run.passed' ? '🟢' : '🟡';
  const statusLabel = event === 'run.failed' ? 'FAILED' : event === 'run.passed' ? 'PASSED' : event.toUpperCase();
  const durationSec = durationMs != null ? (durationMs / 1000).toFixed(1) : null;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${projectName} — ${statusLabel}`,
        emoji: true,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open run', emoji: true },
          url: runUrl,
          action_id: 'open_run',
        },
      ],
    },
  ];

  const maxDisplay = Math.min(5, failedTests.length);
  for (let i = 0; i < maxDisplay; i++) {
    const t = failedTests[i];
    if (!t) continue;

    const fields: unknown[] = [
      {
        type: 'mrkdwn',
        text: `*Failed step* ▸ ${t.stepTitle ? `"${t.stepTitle}" › ` : ''}${t.error.split('\n')[0] ?? t.error}`,
      },
    ];

    if (attempt != null && totalAttempts != null) {
      fields.push({
        type: 'mrkdwn',
        text: `*Failed at* ▸ ${new Date().toISOString()} (attempt ${attempt} of ${totalAttempts}${durationSec ? `, ${durationSec}s` : ''})`,
      });
    }

    if (t.finalUrl) {
      fields.push({
        type: 'mrkdwn',
        text: `*Page URL* ▸ ${t.finalUrl}`,
      });
    }

    const errorFirstLine = t.error.split('\n')[0] ?? t.error;
    fields.push({
      type: 'mrkdwn',
      text: `*Error* ▸ ${errorFirstLine}`,
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${t.name}* (${t.browser})`,
      },
    });
    blocks.push({ type: 'section', fields });
    blocks.push({ type: 'divider' });
  }

  if (totalFailed > 5) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_...and ${totalFailed - 5} more failed test(s)_`,
      },
    });
  }

  // Console errors
  const firstConsoleError = topDiagnostics.consoleErrors[0];
  if (firstConsoleError) {
    const msg =
      typeof firstConsoleError === 'object' && firstConsoleError !== null && 'text' in firstConsoleError
        ? String((firstConsoleError as Record<string, unknown>)['text'])
        : String(firstConsoleError);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Console (${topDiagnostics.consoleErrors.length})* ▸ ${msg.slice(0, 200)}`,
      },
    });
  }

  // Network errors
  const firstNetworkError = topDiagnostics.networkErrors[0];
  if (firstNetworkError) {
    const ne = firstNetworkError as Record<string, unknown>;
    const label =
      ne['method'] && ne['url'] && ne['status']
        ? `${String(ne['method'])} ${String(ne['url'])} → ${String(ne['status'])}`
        : String(firstNetworkError);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Network (${topDiagnostics.networkErrors.length})* ▸ ${label.slice(0, 200)}`,
      },
    });
  }

  return blocks;
}

// ─── Sender ─────────────────────────────────────────────────────────────────

export async function sendSlackNotification(
  slackConfig: SlackConfig,
  payload: SlackNotificationPayload,
): Promise<void> {
  const blocks = buildBlocks(payload);

  const body: Record<string, unknown> = {
    text: `${payload.projectName} run ${payload.event}`,
    blocks,
  };

  if (payload.screenshotUrl) {
    body['attachments'] = [
      {
        image_url: payload.screenshotUrl,
        fallback: 'Screenshot',
      },
    ];
  }

  const bodyStr = JSON.stringify(body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (slackConfig.signingSecret) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', slackConfig.signingSecret)
      .update(`v0:${ts}:${bodyStr}`)
      .digest('hex');
    headers['X-Slack-Request-Timestamp'] = ts;
    headers['X-Slack-Signature'] = `v0=${sig}`;
  }

  const response = await fetch(slackConfig.webhookUrl, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Slack webhook returned ${response.status}: ${text}`);
  }

  logger.info({ event: payload.event, runId: payload.runId }, 'Slack notification sent');
}

export function parseSlackConfig(plaintext: string): SlackConfig {
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== 'object' || parsed === null || !('webhookUrl' in parsed)) {
    throw new Error('Invalid Slack config: must include webhookUrl');
  }
  const p = parsed as Record<string, unknown>;
  return {
    webhookUrl: String(p['webhookUrl']),
    signingSecret: p['signingSecret'] != null ? String(p['signingSecret']) : undefined,
  };
}
