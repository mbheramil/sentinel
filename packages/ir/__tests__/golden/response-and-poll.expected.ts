import { test, expect } from '../fixtures/sentinel';

test('TODO — add test title', async ({ page, vars, secrets, run, capture }) => {
  const created = await page.request.fetch('/api/jobs', {
    method: 'POST',
    data: { kind: 'export' },
  });
  expect(created.status()).toBe(201);
  expect(await created.json()).toMatchObject('queued');
  await expect
    .poll(
      async () => {
        const r = await page.request.fetch('/api/jobs/latest', { method: 'GET' });
        try {
          expect(r.status()).toBe(204);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30000, intervals: [500] },
    )
    .toBe(true);
  await expect(page.getByTestId('job-row')).toHaveCount(3);
});
