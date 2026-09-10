import { test, expect } from '../fixtures/sentinel';

test('TODO — add test title', async ({ page, vars, secrets, run, capture }) => {
  await page.getByLabel('Password').fill(process.env.SENTINEL_SECRET_PASSWORD!);
});
