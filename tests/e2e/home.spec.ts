import { test, expect } from '@playwright/test'

test('home page loads and shows title', async ({ page }) => {
  // When running in CI, the Next.js dev server should be
  // running on port 3000.  In local testing you can adjust
  // baseURL accordingly.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Open Shifts' })).toBeVisible()
})