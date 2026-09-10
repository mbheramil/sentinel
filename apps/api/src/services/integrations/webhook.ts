import { createHmac } from 'node:crypto';
import { logger } from '../../logger.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

export interface WebhookPayload {
  event: string;
  runId: string;
  projectId: string;
  projectName: string;
  status: string;
  failedTests: Array<{
    name: string;
    browser: string;
    error: string;
    stepTitle?: string;
    finalUrl?: string;
  }>;
  topDiagnostics: {
    consoleErrors: unknown[];
    networkErrors: unknown[];
  };
  timestamp: string;
}

// ─── Sender ─────────────────────────────────────────────────────────────────

export async function sendWebhookNotification(
  webhookConfig: WebhookConfig,
  payload: WebhookPayload,
): Promise<void> {
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Sentinel-Timestamp': timestamp,
    ...webhookConfig.headers,
  };

  if (webhookConfig.secret) {
    const sig = createHmac('sha256', webhookConfig.secret)
      .update(`${timestamp}.${bodyStr}`)
      .digest('hex');
    headers['X-Sentinel-Signature'] = `sha256=${sig}`;
  }

  const response = await fetch(webhookConfig.url, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Webhook returned ${response.status}: ${text}`);
  }

  logger.info({ event: payload.event, runId: payload.runId, url: webhookConfig.url }, 'Webhook notification sent');
}

export function parseWebhookConfig(plaintext: string): WebhookConfig {
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== 'object' || parsed === null || !('url' in parsed)) {
    throw new Error('Invalid webhook config: must include url');
  }
  const p = parsed as Record<string, unknown>;
  return {
    url: String(p['url']),
    secret: p['secret'] != null ? String(p['secret']) : undefined,
    headers:
      p['headers'] != null && typeof p['headers'] === 'object'
        ? (p['headers'] as Record<string, string>)
        : undefined,
  };
}
