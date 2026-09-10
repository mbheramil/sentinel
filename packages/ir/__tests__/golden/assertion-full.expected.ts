import { test, expect } from '../fixtures/sentinel';

test('TODO — add test title', async ({ page, vars, secrets, run, capture }) => {
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await expect(page.getByTestId('error-msg')).toBeHidden();
  await expect(page.getByLabel('Email')).toHaveText('user@example.com');
  await expect(page).toHaveURL('/dashboard');
  await expect(page).toHaveTitle('Dashboard');
});
