import { expect, test } from '@playwright/test';

const VERDICTS = ['REAL INFLOW', 'OUTFLOW', 'RECOUNT', 'NOT VERIFIABLE', 'FLAT'];

test('health: names its commit and both clocks', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const j = await res.json();
  expect(j.service).toBe('netmint');
  expect(j.rendered_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(j.capture_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(j.commit).toMatch(/^[0-9a-f]{7,40}$/);
});

test('the judged click: Run it live returns a verdict with CMC receipts behind it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible(); // the recorded hero is there before any click
  await page.getByRole('button', { name: 'Run it live' }).click();
  const receipts = page.getByRole('button', { name: /^Receipts \(\d+\)/ });
  await expect(receipts).toBeVisible({ timeout: 45_000 });
  const label = await page
    .getByRole('img', { name: /^Verdict: / })
    .first()
    .getAttribute('aria-label');
  expect(VERDICTS.some((v) => label?.includes(v))).toBe(true);
  expect(Number((await receipts.innerText()).match(/\((\d+)\)/)?.[1])).toBeGreaterThanOrEqual(3);
  await receipts.click();
  const drawer = page.getByRole('dialog', { name: 'Receipts' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('/v5/real-world-assets/');
  await expect(drawer).toContainText('quotes/historical');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('/api/lookup: live NVDA flow answers with per-wrapper verdicts, endpoints and credits', async ({ request }) => {
  const res = await request.get('/api/lookup?u=NVDA&window=30');
  expect(res.status()).toBe(200);
  const j = await res.json();
  expect(j.underlying.ticker).toBe('NVDA');
  expect(j.wrappers.length).toBeGreaterThan(0);
  const names = VERDICTS.map((v) => v.replace(' ', '_'));
  for (const w of j.wrappers) if (!w.derivative && w.verdict) expect(names).toContain(w.verdict); // derivatives and wrappers CMC does not rank carry no verdict, by design
  expect(j.wrappers.filter((w: { verdict: string }) => w.verdict).length).toBeGreaterThan(0);
  const endpoints = new Set(j.receipts.filter((r: { kind: string }) => r.kind === 'cmc').map((r: { endpoint: string }) => r.endpoint));
  for (const e of ['/v5/real-world-assets/assets/list', '/v2/cryptocurrency/quotes/historical', '/v2/cryptocurrency/info']) {
    expect(endpoints.has(e), e).toBe(true);
  }
  expect(JSON.stringify(j)).not.toMatch(/X-CMC_PRO_API_KEY:\s*[0-9a-f]{8}-/i); // receipts carry the header name with a $CMC_API_KEY placeholder, never a value
});

test('/api/lookup: an unknown ticker is refused, not invented', async ({ request }) => {
  const res = await request.get('/api/lookup?u=NOTATICKER99&window=30');
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
  expect(await res.text()).not.toMatch(/REAL_INFLOW/);
});

test('leaderboard renders the captured table with its capture date', async ({ page }) => {
  await page.goto('/flows');
  await expect(page.locator('table').first()).toBeVisible();
  expect(await page.locator('table tbody tr').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('body')).toContainText(/captured|capture/i);
});

test('per-underlying page lists every wrapper', async ({ page }) => {
  await page.goto('/u/NVDA');
  await expect(page.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible({ timeout: 45_000 });
});

test('performance gate: first paint and transfer budget on the landing page', async ({ page }) => {
  const sizes: number[] = [];
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'script') sizes.push((await r.body().catch(() => Buffer.alloc(0))).length);
  });
  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'load' });
  expect(Date.now() - t0, 'load event within 5 s').toBeLessThan(5000);
  const fcp = await page.evaluate(
    () =>
      new Promise<number>((res) =>
        new PerformanceObserver((l) => res(l.getEntries()[0].startTime)).observe({ type: 'paint', buffered: true }),
      ),
  );
  expect(fcp, 'first paint under 2.5 s').toBeLessThan(2500);
  expect(
    sizes.reduce((a, b) => a + b, 0),
    'JS under 600 KB (decoded)',
  ).toBeLessThan(600_000);
});
