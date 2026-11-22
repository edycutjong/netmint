import { expect, test } from '@playwright/test';

// /judge is the no-login, 30-second path: one button that opens the NVDAB 30-day hero window live through the real app route.
const HERO_PATH = '/u/NVDA?from=2026-10-22&to=2026-11-21';

test('/judge: answers 200 and shows the one primary button, pointing at the real route', async ({ page }) => {
  const res = await page.goto('/judge');
  expect(res?.status()).toBe(200);
  const go = page.getByRole('link', { name: /Open the NVDAB 30-day lookup/ });
  await expect(go).toBeVisible();
  await expect(go).toHaveAttribute('href', HERO_PATH);
  await expect(go).toHaveAttribute('target', '_blank');
  await expect(go).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('body')).not.toContainText(/pending/i); // no video link until a URL exists, never a placeholder label
});

test('/judge → the button opens the NVDAB lookup in a new tab, runs it live, and a REAL INFLOW verdict renders', async ({
  page,
  context,
}) => {
  await page.goto('/judge');
  const popup = context.waitForEvent('page'); // the checklist stays open in the first tab
  await page.getByRole('link', { name: /Open the NVDAB 30-day lookup/ }).click();
  const tab = await popup;
  const lookup = tab.waitForResponse((r) => r.url().includes('/api/lookup'), { timeout: 60_000 });
  await expect(tab).toHaveURL(/\/u\/NVDA\?from=2026-10-22&to=2026-11-21$/);
  const res = await lookup; // the verdict on screen comes from the page's own /api/lookup call for the pinned window
  expect(res.url()).toContain('from=2026-10-22');
  expect(res.url()).toContain('to=2026-11-21');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.underlying.ticker).toBe('NVDA');
  expect(['live', 'cached', 'live-stored']).toContain(body.mode);
  const nvdab = body.wrappers.find((w: { symbol: string }) => w.symbol === 'NVDAB');
  expect(nvdab?.verdict).toBe('REAL_INFLOW');
  await expect(tab.getByRole('img', { name: /^Verdict: REAL INFLOW/ }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('heading', { name: /What to look at/ })).toBeVisible(); // the checklist tab is still there
});
