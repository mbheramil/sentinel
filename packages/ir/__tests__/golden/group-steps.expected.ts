import { test, expect } from '../fixtures/sentinel';

test('TODO — add test title', async ({ page, vars, secrets, run, capture }) => {
  await test.step('Open storefront', async () => {
    const _res0 = await page.goto('/');
    expect(_res0!.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });
  await test.step('Add to cart', async () => {
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });
});
