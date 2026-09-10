/**
 * Sentinel smoke tests — §22.6 canonical reference scenario.
 *
 * These tests exercise the running Sentinel application itself
 * (not tests running inside Sentinel).
 *
 * Prerequisites:
 *   - Sentinel web app running at http://localhost:3000
 *   - Sentinel API running at http://localhost:3001
 *   - viewer@sentinel.local user exists (created by seed script)
 *
 * Run: pnpm --filter @sentinel/e2e test
 */

import { test, expect, type Page } from '@playwright/test';

const API_BASE = process.env['SENTINEL_API_URL'] ?? 'http://localhost:3001/api/v1';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a unique suffix for test isolation. */
function uid() {
  return Date.now().toString(36);
}

/** Sign up a new user and return to the app. */
async function signUp(
  page: Page,
  opts: { name: string; email: string; password: string; orgName: string },
) {
  await page.goto('/signup');
  await page.getByLabel(/name/i).first().fill(opts.name);
  await page.getByLabel(/email/i).fill(opts.email);
  await page.getByLabel(/password/i).fill(opts.password);
  await page.getByLabel(/org/i).fill(opts.orgName);
  await page.getByRole('button', { name: /sign up/i }).click();
  // Wait for redirect to dashboard after signup
  await page.waitForURL('**/projects**', { timeout: 15_000 });
}

/** Sign in with existing credentials. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/projects**', { timeout: 15_000 });
}

/**
 * Poll the API until a run reaches a terminal status or the timeout elapses.
 * Returns the final status string.
 */
async function waitForRunTerminal(
  runId: string,
  timeoutMs = 90_000,
): Promise<string> {
  const terminal = new Set(['PASSED', 'FAILED', 'ERROR', 'CANCELED', 'TIMED_OUT']);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE}/runs/${runId}`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as { status: string };
      if (terminal.has(data.status)) {
        return data.status;
      }
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  throw new Error(`Run ${runId} did not reach terminal state within ${timeoutMs}ms`);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe('Smoke — happy path', () => {
  test('signup → create project → write test → run → see green result', async ({ page }) => {
    const id = uid();
    const email = `e2e-${id}@example.com`;
    const password = 'Sentine1!';

    // 1. Sign up with a new account
    await signUp(page, {
      name: 'E2E User',
      email,
      password,
      orgName: `E2E Org ${id}`,
    });

    // Should land on projects page
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    // 2. Create a project pointing at https://playwright.dev
    await page.getByRole('button', { name: /new project|create project/i }).click();
    await page.getByLabel(/name/i).fill(`Playwright Dev ${id}`);
    await page.getByLabel(/slug/i).fill(`pw-dev-${id}`);
    await page.getByRole('button', { name: /create/i }).click();

    // Wait for project page
    await page.waitForURL(`**/projects/pw-dev-${id}**`, { timeout: 15_000 });

    // 3. Create an environment with baseUrl pointing at playwright.dev
    await page.goto(`/projects/pw-dev-${id}/environments`);
    await page.getByRole('button', { name: /add environment|new environment/i }).click();
    await page.getByLabel(/name/i).fill('production');
    await page.getByLabel(/base url/i).fill('https://playwright.dev');
    await page.getByRole('button', { name: /create|save/i }).click();
    await expect(page.getByText('production')).toBeVisible({ timeout: 10_000 });

    // 4. Create a test
    await page.goto(`/projects/pw-dev-${id}/tests`);
    await page.getByRole('button', { name: /new test|create test/i }).click();
    await page.getByLabel(/name/i).fill('Playwright homepage title');
    await page.getByLabel(/file path/i).fill('tests/homepage.spec.ts');

    // Type test code — the Monaco editor may be a textarea or contenteditable
    const codeInput =
      page.locator('textarea[aria-label*="code" i]').first().or(
        page.locator('.monaco-editor textarea').first(),
      );

    const testCode = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('Playwright homepage has title', async ({ page }) => {",
      "  await page.goto('/');",
      "  await expect(page).toHaveTitle(/Playwright/);",
      '});',
    ].join('\n');

    await codeInput.fill(testCode);
    await page.getByRole('button', { name: /create|save/i }).click();

    // 5. Trigger a run
    await page.goto(`/projects/pw-dev-${id}/tests`);
    await page.getByRole('button', { name: /run/i }).first().click();

    // Pick the environment in the run dialog if present
    const envOption = page.getByRole('option', { name: 'production' });
    if (await envOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await envOption.click();
    }
    const triggerBtn = page.getByRole('button', { name: /start run|trigger run|run now/i });
    if (await triggerBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await triggerBtn.click();
    }

    // Wait for redirect to run page or navigate there
    await page.waitForURL('**/runs/**', { timeout: 15_000 });

    // 6. Poll until terminal
    const runIdMatch = page.url().match(/runs\/([^/]+)/);
    if (!runIdMatch) throw new Error('Could not extract runId from URL');
    const runId = runIdMatch[1];

    const finalStatus = await waitForRunTerminal(runId);

    // 7. Assert status === PASSED (or at least not ERROR)
    expect(finalStatus).toBe('PASSED');

    // 8. The UI should show the result
    await page.goto(`/projects/pw-dev-${id}/runs/${runId}`);
    await expect(page.getByText(/passed/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Smoke — failure path', () => {
  test('failing test shows error and screenshot artifact', async ({ page }) => {
    const id = uid();
    const email = `e2e-fail-${id}@example.com`;

    await signUp(page, {
      name: 'Fail Tester',
      email,
      password: 'Sentine1!',
      orgName: `Fail Org ${id}`,
    });

    // Create project + env
    await page.getByRole('button', { name: /new project|create project/i }).click();
    await page.getByLabel(/name/i).fill(`Failing Project ${id}`);
    await page.getByLabel(/slug/i).fill(`fail-${id}`);
    await page.getByRole('button', { name: /create/i }).click();
    await page.waitForURL(`**/projects/fail-${id}**`, { timeout: 15_000 });

    await page.goto(`/projects/fail-${id}/environments`);
    await page.getByRole('button', { name: /add environment|new environment/i }).click();
    await page.getByLabel(/name/i).fill('default');
    await page.getByLabel(/base url/i).fill('https://playwright.dev');
    await page.getByRole('button', { name: /create|save/i }).click();

    // Create a deliberately broken test
    await page.goto(`/projects/fail-${id}/tests`);
    await page.getByRole('button', { name: /new test|create test/i }).click();
    await page.getByLabel(/name/i).fill('Intentional failure');
    await page.getByLabel(/file path/i).fill('tests/broken.spec.ts');

    const brokenCode = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('this test fails on purpose', async ({ page }) => {",
      "  await page.goto('/');",
      "  await expect(page.getByText('this text does not exist anywhere')).toBeVisible({ timeout: 3000 });",
      '});',
    ].join('\n');

    const codeInput =
      page.locator('textarea[aria-label*="code" i]').first().or(
        page.locator('.monaco-editor textarea').first(),
      );
    await codeInput.fill(brokenCode);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Run it
    await page.goto(`/projects/fail-${id}/tests`);
    await page.getByRole('button', { name: /run/i }).first().click();
    const triggerBtn = page.getByRole('button', { name: /start run|trigger run|run now/i });
    if (await triggerBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await triggerBtn.click();
    }
    await page.waitForURL('**/runs/**', { timeout: 15_000 });

    const runIdMatch = page.url().match(/runs\/([^/]+)/);
    if (!runIdMatch) throw new Error('Could not extract runId from URL');
    const runId = runIdMatch[1];

    const finalStatus = await waitForRunTerminal(runId);
    expect(['FAILED', 'ERROR']).toContain(finalStatus);

    // Verify the UI shows a failure indicator
    await page.goto(`/projects/fail-${id}/runs/${runId}`);
    await expect(
      page.getByText(/failed/i).first().or(page.getByText(/error/i).first()),
    ).toBeVisible({ timeout: 10_000 });

    // The error message or screenshot artifact should be visible somewhere on the run page
    await expect(
      page.getByText(/this text does not exist/i)
        .or(page.getByText(/timeout/i))
        .or(page.getByText(/screenshot/i))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('RBAC', () => {
  test('viewer cannot trigger runs', async ({ page }) => {
    // Sign in as the seeded viewer account
    const viewerEmail = 'viewer@sentinel.local';
    const viewerPassword = 'viewer1234'; // as set in seed script

    await signIn(page, viewerEmail, viewerPassword);

    // Navigate to any project that exists
    await page.goto('/projects');

    // Find the first project link and navigate to it
    const firstProject = page.getByRole('link', { name: /project|demo/i }).first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });
    await firstProject.click();
    await page.waitForURL('**/projects/**', { timeout: 10_000 });

    // Navigate to runs page
    await page.getByRole('link', { name: /runs/i }).click();
    await page.waitForURL('**/runs**', { timeout: 10_000 });

    // The "Run" / "Trigger run" button should not be present or should be disabled
    const runButton = page.getByRole('button', { name: /^run$|trigger run|new run/i });
    const isVisible = await runButton.isVisible({ timeout: 3_000 }).catch(() => false);

    if (isVisible) {
      // If the button is rendered, it must be disabled for viewers
      await expect(runButton).toBeDisabled();
    }
    // If not visible at all, the RBAC check passed — no assertion needed
  });
});
