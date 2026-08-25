import { expect, test } from '@playwright/test';

test('shopfront exposes the catalog and keeps internal routes private', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Things with a pulse.' })).toBeVisible();
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'The current edit.' })).toBeVisible();
  const internal = await page.request.get('/api/internal/traffic/runner/status');
  expect(internal.status()).toBe(404);
});

test('auth page does not reload itself when an anonymous API call reports an expired session', async ({ page }) => {
  await page.route('**/api/cart', async (route) => {
    await route.fulfill({
      status: 401,
      headers: { 'content-type': 'application/json', 'x-session-expired': '1' },
      body: JSON.stringify({ code: 401, message: '会话已过期', data: null }),
    });
  });

  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'Know who is here.' })).toBeVisible();

  let reloads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().endsWith('/auth')) reloads += 1;
  });
  await page.waitForTimeout(500);

  expect(page.url()).toMatch(/\/auth$/);
  expect(reloads).toBe(0);
});
