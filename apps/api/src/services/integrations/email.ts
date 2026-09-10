import { config } from '../../config.js';
import { logger } from '../../logger.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmailConfig {
  to: string | string[];
  from?: string;
}

export interface EmailPayload {
  event: string;
  projectName: string;
  runId: string;
  sentinelPublicUrl: string;
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
  totalFailed: number;
  durationMs?: number | null;
}

// ─── HTML Template ──────────────────────────────────────────────────────────

function buildHtmlBody(payload: EmailPayload): string {
  const {
    event,
    projectName,
    runId,
    sentinelPublicUrl,
    failedTests,
    topDiagnostics,
    totalFailed,
    durationMs,
  } = payload;

  const runUrl = `${sentinelPublicUrl}/runs/${runId}`;
  const emoji = event === 'run.failed' ? '🔴' : event === 'run.passed' ? '🟢' : '🟡';
  const statusLabel = event === 'run.failed' ? 'FAILED' : event === 'run.passed' ? 'PASSED' : event.toUpperCase();
  const durationStr = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '';

  const failedTestRows = failedTests
    .slice(0, 5)
    .map(
      (t) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${escapeHtml(t.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(t.browser)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-family:monospace;font-size:12px;">
        ${escapeHtml(t.error.split('\n')[0] ?? t.error)}
      </td>
    </tr>`,
    )
    .join('');

  const moreNote =
    totalFailed > 5
      ? `<p style="color:#6b7280;font-style:italic;">...and ${totalFailed - 5} more failed test(s)</p>`
      : '';

  const firstConsoleError = topDiagnostics.consoleErrors[0];
  const consoleSection =
    firstConsoleError != null
      ? `<h3 style="color:#374151;">Console Errors (${topDiagnostics.consoleErrors.length})</h3>
         <pre style="background:#f9fafb;padding:12px;border-radius:4px;font-size:12px;overflow:auto;">${escapeHtml(String(firstConsoleError)).slice(0, 500)}</pre>`
      : '';

  const firstNetworkError = topDiagnostics.networkErrors[0];
  const networkSection =
    firstNetworkError != null
      ? `<h3 style="color:#374151;">Network Errors (${topDiagnostics.networkErrors.length})</h3>
         <pre style="background:#f9fafb;padding:12px;border-radius:4px;font-size:12px;overflow:auto;">${escapeHtml(String(firstNetworkError)).slice(0, 500)}</pre>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Sentinel Run ${statusLabel}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#111827;">
  <h1 style="font-size:24px;">${emoji} ${escapeHtml(projectName)} — ${statusLabel}</h1>
  ${durationStr ? `<p style="color:#6b7280;">Duration: ${durationStr}</p>` : ''}
  <p><a href="${runUrl}" style="background:#3b82f6;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;">View Run</a></p>
  ${
    failedTests.length > 0
      ? `<h2 style="color:#dc2626;">Failed Tests (${totalFailed})</h2>
         <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
           <thead>
             <tr style="background:#f3f4f6;">
               <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Test</th>
               <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Browser</th>
               <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Error</th>
             </tr>
           </thead>
           <tbody>${failedTestRows}</tbody>
         </table>
         ${moreNote}`
      : ''
  }
  ${consoleSection}
  ${networkSection}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
  <p style="color:#9ca3af;font-size:12px;">Sent by <a href="${sentinelPublicUrl}" style="color:#6b7280;">Sentinel</a> · Run ID: ${runId}</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Resend API ─────────────────────────────────────────────────────────────

async function sendViaResend(
  emailConfig: EmailConfig,
  subject: string,
  htmlBody: string,
): Promise<void> {
  const to = Array.isArray(emailConfig.to) ? emailConfig.to : [emailConfig.to];
  const from = emailConfig.from ?? config.MAIL_FROM;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html: htmlBody }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Resend API returned ${response.status}: ${text}`);
  }
}

// ─── SMTP via nodemailer ─────────────────────────────────────────────────────

/** Minimal structural type for the optional `nodemailer` dependency. */
interface NodemailerTransport {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<unknown>;
}

interface NodemailerModule {
  createTransport: (url: string) => NodemailerTransport;
  default?: { createTransport: (url: string) => NodemailerTransport };
}

async function sendViaSmtp(
  emailConfig: EmailConfig,
  subject: string,
  htmlBody: string,
): Promise<void> {
  // nodemailer is an optional dependency: SMTP is only one of several delivery
  // routes, so we don't force everyone to install it. The specifier goes through
  // a variable on purpose — a literal would make TS try to resolve a module that
  // legitimately may not be present and fail the build with TS2307.
  const specifier = 'nodemailer';
  const mod = (await import(specifier).catch(() => null)) as NodemailerModule | null;
  if (!mod) {
    throw new Error('nodemailer is not installed and RESEND_API_KEY is not set');
  }

  if (!config.SMTP_URL) {
    throw new Error('SMTP_URL is not configured');
  }

  const to = Array.isArray(emailConfig.to) ? emailConfig.to.join(', ') : emailConfig.to;
  const from = emailConfig.from ?? config.MAIL_FROM;

  // Both ESM (`.default`) and CJS interop shapes are possible depending on how
  // the consumer's bundler/runtime resolves it.
  const createTransport = mod.default?.createTransport ?? mod.createTransport;
  const transporter = createTransport(config.SMTP_URL);
  await transporter.sendMail({ from, to, subject, html: htmlBody });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function sendEmailNotification(
  emailConfig: EmailConfig,
  payload: EmailPayload,
): Promise<void> {
  const statusLabel =
    payload.event === 'run.failed'
      ? 'FAILED'
      : payload.event === 'run.passed'
        ? 'PASSED'
        : payload.event.toUpperCase();

  const subject = `[Sentinel] ${payload.projectName} — ${statusLabel}`;
  const htmlBody = buildHtmlBody(payload);

  if (config.RESEND_API_KEY) {
    await sendViaResend(emailConfig, subject, htmlBody);
  } else {
    await sendViaSmtp(emailConfig, subject, htmlBody);
  }

  logger.info({ event: payload.event, runId: payload.runId, to: emailConfig.to }, 'Email notification sent');
}

export function parseEmailConfig(plaintext: string): EmailConfig {
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== 'object' || parsed === null || !('to' in parsed)) {
    throw new Error('Invalid email config: must include to');
  }
  const p = parsed as Record<string, unknown>;
  const to = p['to'];
  if (typeof to !== 'string' && !Array.isArray(to)) {
    throw new Error('Invalid email config: to must be a string or array');
  }
  return {
    to: to as string | string[],
    from: p['from'] != null ? String(p['from']) : undefined,
  };
}
