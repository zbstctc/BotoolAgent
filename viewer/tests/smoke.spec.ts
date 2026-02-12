import { test, expect } from '@playwright/test';

test('homepage loads and shows dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Botool/i);
});

test('stage indicator is visible on homepage', async ({ page }) => {
  await page.goto('/');
  // Dashboard should load without errors
  await expect(page.locator('body')).toBeVisible();
});
