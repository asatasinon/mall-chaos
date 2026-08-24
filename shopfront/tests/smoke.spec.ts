import { expect, test } from '@playwright/test';

test('shopfront exposes the catalog and keeps internal routes private', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Things with a pulse.' })).toBeVisible();
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'The current edit.' })).toBeVisible();
  const internal = await page.request.get('/api/internal/traffic/runner/status');
  expect(internal.status()).toBe(404);
});
