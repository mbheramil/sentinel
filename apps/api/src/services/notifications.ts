import { Queue, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { prisma } from '@sentinel/db';
import { getRedis } from '../lib/redis.js';
import { logger } from '../logger.js';
import { decrypt, bufferToEnvelope } from './encryption.js';
import { sendSlackNotification, parseSlackConfig } from './integrations/slack.js';
import { sendWebhookNotification, parseWebhookConfig } from './integrations/webhook.js';
import { sendEmailNotification, parseEmailConfig } from './integrations/email.js';
import { config } from '../config.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FailedTestInfo {
  name: string;
  browser: string;
  error: string;
  stepTitle?: string;
  finalUrl?: string;
}

export interface NotificationPayload {
  event: 'run.failed' | 'run.passed' | 'run.recovered' | 'run.flaky' | 'schedule.failed';
  run: {
    id: string;
    projectId: string;
    status: string;
    durationMs?: number | null;
    project: {
      id: string;
      name: string;
      orgId: string;
    };
    environment: {
      id: string;
      name: string;
    };
  };
  failedTests: FailedTestInfo[];
  topDiagnostics: {
    consoleErrors: unknown[];
    networkErrors: unknown[];
  };
}

interface NotificationJobData {
  integrationId: string;
  notificationId: string;
  payload: NotificationPayload;
}

// ─── Queue singleton ────────────────────────────────────────────────────────

let _notifQueue: Queue<NotificationJobData> | null = null;

function getNotifQueue(): Queue<NotificationJobData> {
  if (!_notifQueue) {
    const connection = getRedis() as Redis;
    _notifQueue = new Queue<NotificationJobData>('sentinel-notifications', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
  }
  return _notifQueue;
}

// ─── Dedup helper ───────────────────────────────────────────────────────────

function computeErrorSignature(failedTests: FailedTestInfo[]): string {
  const parts = failedTests
    .slice(0, 3)
    .map((t) => `${t.name}:${t.browser}:${t.error.slice(0, 100)}`)
    .join('|');
  return Buffer.from(parts).toString('base64').slice(0, 64);
}

async function isDuplicate(
  integrationId: string,
  errorSignature: string,
): Promise<boolean> {
  const redis = getRedis();
  const dedupKey = `notif:dedup:${integrationId}:${errorSignature}`;
  const exists = await redis.exists(dedupKey);
  if (exists) return true;
  // Set dedup key with 1h TTL
  await redis.setex(dedupKey, 3_600, '1');
  return false;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

let _notifWorker: Worker<NotificationJobData> | null = null;

const MAX_CONSECUTIVE_FAILURES = 20;

async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { integrationId, notificationId, payload } = job.data;

  // Mark notification as in-progress
  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: 'processing', attempts: { increment: 1 } },
  }).catch(() => {});

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: {
      id: true,
      type: true,
      isEnabled: true,
      configCiphertext: true,
      consecutiveFailures: true,
    },
  });

  if (!integration || !integration.isEnabled) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'skipped' },
    }).catch(() => {});
    return;
  }

  // Decrypt config
  let configPlaintext: string;
  try {
    const envelope = bufferToEnvelope(integration.configCiphertext);
    configPlaintext = decrypt(envelope);
  } catch (err) {
    logger.error({ integrationId, err }, 'Failed to decrypt integration config');
    throw err;
  }

  const run = payload.run;
  const totalFailed = payload.failedTests.length;

  try {
    switch (integration.type) {
      case 'SLACK': {
        const slackCfg = parseSlackConfig(configPlaintext);
        await sendSlackNotification(slackCfg, {
          event: payload.event,
          projectName: run.project.name,
          runId: run.id,
          sentinelPublicUrl: config.SENTINEL_PUBLIC_URL,
          failedTests: payload.failedTests,
          topDiagnostics: payload.topDiagnostics,
          totalFailed,
          durationMs: run.durationMs,
        });
        break;
      }
      case 'WEBHOOK': {
        const webhookCfg = parseWebhookConfig(configPlaintext);
        await sendWebhookNotification(webhookCfg, {
          event: payload.event,
          runId: run.id,
          projectId: run.projectId,
          projectName: run.project.name,
          status: run.status,
          failedTests: payload.failedTests,
          topDiagnostics: payload.topDiagnostics,
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case 'EMAIL': {
        const emailCfg = parseEmailConfig(configPlaintext);
        await sendEmailNotification(emailCfg, {
          event: payload.event,
          projectName: run.project.name,
          runId: run.id,
          sentinelPublicUrl: config.SENTINEL_PUBLIC_URL,
          failedTests: payload.failedTests,
          topDiagnostics: payload.topDiagnostics,
          totalFailed,
          durationMs: run.durationMs,
        });
        break;
      }
      default:
        logger.warn({ integrationId, type: integration.type }, 'Unknown integration type');
        return;
    }

    // Success — reset consecutive failures and mark as sent
    await Promise.all([
      prisma.integration.update({
        where: { id: integrationId },
        data: { consecutiveFailures: 0 },
      }),
      prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      }),
    ]);
  } catch (err) {
    const newCount = integration.consecutiveFailures + 1;
    logger.error({ integrationId, notificationId, err, consecutiveFailures: newCount }, 'Notification delivery failed');

    const updateData: {
      consecutiveFailures: number;
      isEnabled?: boolean;
    } = { consecutiveFailures: newCount };

    if (newCount >= MAX_CONSECUTIVE_FAILURES) {
      updateData.isEnabled = false;
      logger.warn({ integrationId, newCount }, 'Integration auto-disabled after consecutive failures');
    }

    await prisma.integration.update({
      where: { id: integrationId },
      data: updateData,
    }).catch(() => {});

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'failed', lastError: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});

    // Re-throw to trigger BullMQ retry with backoff
    throw err;
  }
}

export function startNotificationWorker(): void {
  if (_notifWorker) return;

  const connection = getRedis() as Redis;
  _notifWorker = new Worker<NotificationJobData>(
    'sentinel-notifications',
    processNotificationJob,
    { connection, concurrency: 10 },
  );

  _notifWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Notification job permanently failed');
  });

  logger.info('Notification worker started');
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fireNotifications(payload: NotificationPayload): Promise<void> {
  const { run } = payload;
  const errorSignature = computeErrorSignature(payload.failedTests);

  // Find all enabled integrations for this project/org that match the event
  const integrations = await prisma.integration.findMany({
    where: {
      isEnabled: true,
      events: { has: payload.event },
      OR: [
        { orgId: run.project.orgId, projectId: null },
        { projectId: run.projectId },
      ],
    },
    select: { id: true },
  });

  if (integrations.length === 0) return;

  const queue = getNotifQueue();

  await Promise.all(
    integrations.map(async (integration) => {
      // Dedup check
      const dup = await isDuplicate(integration.id, errorSignature);
      if (dup) {
        logger.info({ integrationId: integration.id, runId: run.id }, 'Notification deduped');
        return;
      }

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          integrationId: integration.id,
          runId: run.id,
          status: 'pending',
        },
        select: { id: true },
      });

      // Enqueue BullMQ job
      await queue.add(
        `notif:${notification.id}`,
        {
          integrationId: integration.id,
          notificationId: notification.id,
          payload,
        },
        { jobId: `notif:${notification.id}` },
      );

      logger.info({ integrationId: integration.id, notificationId: notification.id, event: payload.event }, 'Notification enqueued');
    }),
  );
}

/**
 * Send a test notification to an integration (used by the /test endpoint).
 */
export async function sendTestNotification(integrationId: string): Promise<void> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { type: true, configCiphertext: true, orgId: true },
  });

  if (!integration) throw new Error('Integration not found');

  const envelope = bufferToEnvelope(integration.configCiphertext);
  const configPlaintext = decrypt(envelope);

  const testPayload: NotificationPayload = {
    event: 'run.failed',
    run: {
      id: 'test-run-id',
      projectId: 'test-project-id',
      status: 'FAILED',
      durationMs: 12_345,
      project: { id: 'test-project-id', name: 'Test Project', orgId: integration.orgId },
      environment: { id: 'test-env-id', name: 'production' },
    },
    failedTests: [
      {
        name: 'test notification',
        browser: 'CHROMIUM',
        error: 'TimeoutError: This is a test notification from Sentinel',
        stepTitle: 'click button',
        finalUrl: config.SENTINEL_PUBLIC_URL,
      },
    ],
    topDiagnostics: { consoleErrors: [], networkErrors: [] },
  };

  switch (integration.type) {
    case 'SLACK': {
      const slackCfg = parseSlackConfig(configPlaintext);
      await sendSlackNotification(slackCfg, {
        event: testPayload.event,
        projectName: testPayload.run.project.name,
        runId: testPayload.run.id,
        sentinelPublicUrl: config.SENTINEL_PUBLIC_URL,
        failedTests: testPayload.failedTests,
        topDiagnostics: testPayload.topDiagnostics,
        totalFailed: 1,
        durationMs: testPayload.run.durationMs,
      });
      break;
    }
    case 'WEBHOOK': {
      const webhookCfg = parseWebhookConfig(configPlaintext);
      await sendWebhookNotification(webhookCfg, {
        event: testPayload.event,
        runId: testPayload.run.id,
        projectId: testPayload.run.projectId,
        projectName: testPayload.run.project.name,
        status: testPayload.run.status,
        failedTests: testPayload.failedTests,
        topDiagnostics: testPayload.topDiagnostics,
        timestamp: new Date().toISOString(),
      });
      break;
    }
    case 'EMAIL': {
      const emailCfg = parseEmailConfig(configPlaintext);
      await sendEmailNotification(emailCfg, {
        event: testPayload.event,
        projectName: testPayload.run.project.name,
        runId: testPayload.run.id,
        sentinelPublicUrl: config.SENTINEL_PUBLIC_URL,
        failedTests: testPayload.failedTests,
        topDiagnostics: testPayload.topDiagnostics,
        totalFailed: 1,
        durationMs: testPayload.run.durationMs,
      });
      break;
    }
    default:
      throw new Error(`Unknown integration type: ${String(integration.type)}`);
  }
}
