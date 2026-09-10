import { PrismaClient, Role, Browser, AuthoringMode, RunTrigger, RunStatus, TestStatus } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function main() {
  console.log('Seeding database...');

  // Clean up existing seed data — delete children before parents
  await prisma.notification.deleteMany({});
  await prisma.artifact.deleteMany({});
  await prisma.stepResult.deleteMany({});
  await prisma.attempt.deleteMany({});
  await prisma.runTest.deleteMany({});
  await prisma.runShard.deleteMany({});
  await prisma.run.deleteMany({});
  await prisma.schedule.deleteMany({});
  await prisma.suiteItem.deleteMany({});
  await prisma.suite.deleteMany({});
  await prisma.testVersion.deleteMany({});
  await prisma.testCase.deleteMany({});
  await prisma.environment.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.organization.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { in: ['demo@sentinel.local', 'viewer@sentinel.local'] } } });

  // Create users
  const owner = await prisma.user.create({
    data: {
      email: 'demo@sentinel.local',
      name: 'Demo Owner',
      passwordHash: await hashPassword('demo1234'),
      emailVerifiedAt: new Date(),
    },
  });

  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@sentinel.local',
      name: 'Demo Viewer',
      passwordHash: await hashPassword('demo1234'),
      emailVerifiedAt: new Date(),
    },
  });

  // Create org
  const org = await prisma.organization.create({
    data: {
      name: 'Demo Co',
      slug: 'demo-co',
    },
  });

  // Memberships
  await prisma.membership.createMany({
    data: [
      { userId: owner.id, orgId: org.id, role: Role.OWNER },
      { userId: viewer.id, orgId: org.id, role: Role.VIEWER },
    ],
  });

  // Project
  const project = await prisma.project.create({
    data: {
      orgId: org.id,
      name: 'Demo Site',
      slug: 'demo-site',
      description: 'End-to-end tests for the demo public website',
      defaultBrowsers: [Browser.CHROMIUM],
      defaultTimeoutMs: 30000,
      defaultRetries: 1,
    },
  });

  // Environments
  const prodEnv = await prisma.environment.create({
    data: {
      projectId: project.id,
      name: 'production',
      baseUrl: 'https://playwright.dev',
      isDefault: true,
      variables: { DEMO_VAR: 'hello' },
    },
  });

  await prisma.environment.create({
    data: {
      projectId: project.id,
      name: 'staging',
      baseUrl: 'https://playwright.dev',
      variables: { DEMO_VAR: 'staging-hello' },
    },
  });

  // Test cases
  const test1 = await prisma.testCase.create({
    data: {
      projectId: project.id,
      name: 'Homepage loads',
      filePath: 'specs/homepage.spec.ts',
      authoringMode: AuthoringMode.CODE,
      code: `import { test, expect } from '../fixtures/sentinel';

test('homepage loads', async ({ page }) => {
  const res = await page.goto('/');
  expect(res!.status(), 'homepage status').toBe(200);
  await expect(page).toHaveTitle(/Playwright/);
  await expect(page.getByRole('heading', { name: 'Playwright enables reliable' })).toBeVisible();
});
`,
      tags: ['smoke', 'homepage'],
    },
  });

  const test2 = await prisma.testCase.create({
    data: {
      projectId: project.id,
      name: 'Docs navigation',
      filePath: 'specs/docs-nav.spec.ts',
      authoringMode: AuthoringMode.CODE,
      code: `import { test, expect } from '../fixtures/sentinel';

test('docs navigation works', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Docs' }).click();
  await expect(page).toHaveURL(/\/docs/);
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
`,
      tags: ['smoke', 'navigation'],
    },
  });

  const test3 = await prisma.testCase.create({
    data: {
      projectId: project.id,
      name: 'Search returns results',
      filePath: 'specs/search.spec.ts',
      authoringMode: AuthoringMode.CODE,
      code: `import { test, expect } from '../fixtures/sentinel';

// This test is intentionally failing to demonstrate failure UX
test('search returns results', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'This does not exist' })).toBeVisible();
});
`,
      tags: ['search'],
    },
  });

  const test4 = await prisma.testCase.create({
    data: {
      projectId: project.id,
      name: 'Flaky example',
      filePath: 'specs/flaky.spec.ts',
      authoringMode: AuthoringMode.CODE,
      code: `import { test, expect } from '../fixtures/sentinel';

// Intentionally flaky: fails ~50% of the time
test('flaky coin flip', async ({ page }) => {
  await page.goto('/');
  const pass = Math.random() > 0.5;
  await expect(page.getByRole('heading', { name: pass ? 'Playwright enables reliable' : 'this will never match' })).toBeVisible();
});
`,
      tags: ['flaky'],
      isMuted: true,
    },
  });

  const test5 = await prisma.testCase.create({
    data: {
      projectId: project.id,
      name: 'Login flow (builder)',
      filePath: 'specs/login.spec.ts',
      authoringMode: AuthoringMode.BUILDER,
      stepsIr: {
        version: 1,
        steps: [
          { kind: 'goto', url: '/login' },
          { kind: 'fill', target: { by: 'label', value: 'Email' }, value: { literal: 'user@example.com' } },
          { kind: 'fill', target: { by: 'label', value: 'Password' }, value: { secret: 'PASSWORD' } },
          { kind: 'click', target: { by: 'role', role: 'button', name: 'Sign in' } },
          { kind: 'expect', assertion: { on: 'page', is: 'url', expected: { literal: '/dashboard' } } },
        ],
      },
      code: `import { test, expect } from '../fixtures/sentinel';

test('login flow', async ({ page, secrets }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill(secrets.PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
});
`,
      tags: ['auth'],
    },
  });

  // Suite
  const suite = await prisma.suite.create({
    data: {
      projectId: project.id,
      name: 'Smoke Suite',
      mode: 'EXPLICIT',
      items: {
        create: [
          { testCaseId: test1.id, position: 0 },
          { testCaseId: test2.id, position: 1 },
          { testCaseId: test3.id, position: 2 },
        ],
      },
    },
  });

  // Disabled schedule
  await prisma.schedule.create({
    data: {
      projectId: project.id,
      suiteId: suite.id,
      environmentId: prodEnv.id,
      name: 'Nightly smoke',
      cron: '0 0 * * *',
      timezone: 'UTC',
      browsers: [Browser.CHROMIUM],
      isEnabled: false,
      overlapPolicy: 'SKIP',
    },
  });

  // Historical runs with fabricated results
  for (let i = 0; i < 3; i++) {
    const runStatus = i === 1 ? RunStatus.FAILED : RunStatus.PASSED;
    const started = new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000);
    const finished = new Date(started.getTime() + 45000);

    const run = await prisma.run.create({
      data: {
        projectId: project.id,
        suiteId: suite.id,
        environmentId: prodEnv.id,
        trigger: RunTrigger.MANUAL,
        status: runStatus,
        browsers: [Browser.CHROMIUM],
        shardCount: 1,
        createdByUserId: owner.id,
        queuedAt: started,
        startedAt: started,
        finishedAt: finished,
        durationMs: 45000,
        totals: {
          total: 3,
          passed: runStatus === RunStatus.PASSED ? 3 : 2,
          failed: runStatus === RunStatus.FAILED ? 1 : 0,
          flaky: 0,
          skipped: 0,
          muted: 0,
          timedOut: 0,
        },
      },
    });

    // Create shard
    await prisma.runShard.create({
      data: {
        runId: run.id,
        index: 0,
        total: 1,
        status: runStatus,
        claimedAt: started,
        heartbeatAt: finished,
        finishedAt: finished,
      },
    });

    // Version snapshot for each test
    const versionMap: Record<string, string> = {};
    for (const tc of [test1, test2, test3]) {
      const ver = await prisma.testVersion.create({
        data: {
          testCaseId: tc.id,
          version: i + 1,
          code: tc.code,
          message: `Run ${i + 1} snapshot`,
          createdByUserId: owner.id,
        },
      });
      versionMap[tc.id] = ver.id;
    }

    // RunTest rows
    for (let t = 0; t < 3; t++) {
      const tc = [test1, test2, test3][t]!;
      const isFailingTest = i === 1 && t === 2;
      const testStatus = isFailingTest ? TestStatus.FAILED : TestStatus.PASSED;

      const runTest = await prisma.runTest.create({
        data: {
          runId: run.id,
          testCaseId: tc.id,
          testVersionId: versionMap[tc.id]!,
          shardIndex: 0,
          browser: Browser.CHROMIUM,
          projectLabel: 'chromium',
          status: testStatus,
          durationMs: 8000 + t * 2000,
        },
      });

      await prisma.attempt.create({
        data: {
          runTestId: runTest.id,
          index: 0,
          status: testStatus,
          startedAt: started,
          finishedAt: new Date(started.getTime() + 8000),
          durationMs: 8000,
          errorName: isFailingTest ? 'TimeoutError' : null,
          errorMessage: isFailingTest ? "Timeout 5000ms exceeded.\n=========================== logs ===========================\nwaiting for locator('button', {name: 'This does not exist'})\n============================================================" : null,
        },
      });
    }
  }

  // Update test currentVersionId
  for (const tc of [test1, test2, test3, test4, test5]) {
    const latest = await prisma.testVersion.findFirst({
      where: { testCaseId: tc.id },
      orderBy: { version: 'desc' },
    });
    if (latest) {
      await prisma.testCase.update({
        where: { id: tc.id },
        data: { currentVersionId: latest.id },
      });
    }
  }

  console.log('✓ Seeded:');
  console.log(`  org:     ${org.slug}`);
  console.log(`  owner:   demo@sentinel.local / demo1234`);
  console.log(`  viewer:  viewer@sentinel.local / demo1234`);
  console.log(`  project: ${project.slug} (${project.id})`);
  console.log(`  tests:   5 (2 passing, 1 failing, 1 flaky, 1 builder)`);
  console.log(`  runs:    3 historical`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
