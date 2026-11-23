import { expect, test } from '@playwright/test';

// @upstream = needs the server's CMC and RPC keys; a secretless CI run (Dependabot or fork PR) skips those, main runs all

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

test('the judged click: Run it live returns a verdict with CMC receipts behind it @upstream', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible(); // the recorded hero is there before any click
  const lookup = page.waitForResponse((r) => r.url().includes('/api/lookup'));
  await page.getByRole('button', { name: 'Run it live' }).click();
  const res = await lookup; // the verdict on screen must come from this call, not from the recorded hero
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.underlying.ticker).toBe('NVDA');
  expect(['live', 'cached', 'live-stored']).toContain(body.mode);
  const verdicts = new Set(body.wrappers.map((w: { verdict: string }) => w.verdict).filter(Boolean));
  expect(verdicts.size).toBeGreaterThan(0);
  const receipts = page.getByRole('button', { name: /^Receipts \(\d+\)/ });
  await expect(receipts).toBeVisible({ timeout: 45_000 });
  // the stamp on screen must carry a verdict that the click's own response returned for one of its wrappers
  const names = [...verdicts].map((v) => (v as string).replace('_', ' ')); // letters and spaces only, safe in a RegExp
  await expect(page.getByRole('img', { name: /^Verdict: / }).first()).toHaveAttribute('aria-label', new RegExp(names.join('|')));
  // the card now carries the click's own capture line, not the recorded hero's (the recorded stamp can share a verdict word)
  const card = page.locator('section.card').first();
  await expect(card).not.toContainText('recorded capture');
  await expect(card).toContainText(`${body.live ? 'live' : body.mode} capture`);
  expect(Number((await receipts.innerText()).match(/\((\d+)\)/)?.[1])).toBeGreaterThanOrEqual(3);
  await receipts.click();
  const drawer = page.getByRole('dialog', { name: 'Receipts' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('/v5/real-world-assets/');
  await expect(drawer).toContainText('quotes/historical');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('/api/lookup: live NVDA flow answers with per-wrapper verdicts, endpoints and credits @upstream', async ({ request }) => {
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

test('/api/lookup: an uncached lookup reaches CMC live (a successful, non-stored CMC receipt) @upstream', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop', 'one upstream provenance gate per run (7 CMC credits)');
  test.setTimeout(240_000);
  type GateReceipt = { kind: string; stored?: unknown; httpStatus: number; errorCode?: number; endpoint: string };
  type GateResult = { cacheHit: boolean; mode: string; receipts: GateReceipt[] };
  let fresh: GateResult | undefined;
  // window=7 is not used by the other specs, so the 60 s de-dupe rarely answers it; poll past it if it does
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/lookup?u=NVDA&window=7', { timeout: 60_000 });
        expect(res.status()).toBe(200);
        const body = (await res.json()) as GateResult;
        if (body.cacheHit !== false) return false;
        fresh = body;
        return true;
      },
      { timeout: 180_000, intervals: [5_000, 20_000, 30_000] },
    )
    .toBe(true);
  // after the plan revert quotes/historical may be refused and answered from a stored body (live-stored); that is allowed,
  // but at least one CMC call in this response must have succeeded live: a refusal plus its stored answer is not enough
  const live = fresh!.receipts.filter((r) => r.kind === 'cmc' && !r.stored && r.httpStatus === 200 && (r.errorCode ?? 0) === 0);
  expect(live.length, `successful live CMC receipt (mode ${fresh!.mode})`).toBeGreaterThan(0);
});

test('/api/lookup: an unknown ticker is refused, not invented @upstream', async ({ request }) => {
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

test('per-underlying page renders verdict stamps from a live lookup @upstream', async ({ page }) => {
  const lookup = page.waitForResponse((r) => r.url().includes('/api/lookup'), { timeout: 60_000 });
  await page.goto('/u/NVDA');
  expect((await lookup).status()).toBe(200); // the stamps come from the page's own /api/lookup call
  await expect(page.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible({ timeout: 45_000 });
});

test('performance gate: first paint and transfer budget on the landing page', async ({ page }) => {
  // every script body read is tracked and awaited before the sum; a failed read fails the gate instead of counting as 0
  const reads: Promise<number>[] = [];
  page.on('response', (r) => {
    if (r.request().resourceType() === 'script') reads.push(r.body().then((b) => b.length));
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
  const sizes = await Promise.all(reads);
  expect(sizes.length, 'scripts observed').toBeGreaterThan(0);
  expect(
    sizes.reduce((a, b) => a + b, 0),
    'JS under 600 KB (decoded)',
  ).toBeLessThan(600_000);
});
