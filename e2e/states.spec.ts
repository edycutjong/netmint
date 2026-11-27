import { expect, test } from '@playwright/test';
import { lookup } from '../lib/lookup';
import { Recorder } from '../lib/receipts';
import { storeFrom, type StoredBody } from '../lib/stored';
import { fixture, NOW, recordedTransport } from '../tests/helpers';

// States of the judged pages that cannot be produced on demand: CMC refusing a call on plan, a run that fails, and a CMC
// day missing inside a verified window. The page under test is the deployed one; only API RESPONSES are replaced, in the
// browser, and each test says so: /api/lookup in all of them, and /api/holders in the first (its holder panel is not part
// of that state).
// The refused-plan body is not written by hand: lib/lookup builds it here from the recorded CMC bodies in tests/fixtures,
// with quotes/historical answering CMC's documented 1006 and one wrapper on the "live" list that no stored body holds.
// No test here needs the server's CMC or RPC key, so a secretless CI run executes them too.

const HIST = '/v2/cryptocurrency/quotes/historical';
const RWA = '/v5/real-world-assets/quotes/latest';
const NEW_ID = 999001;
const NVDAB = 40215;
const FAILED = {
  status: 503,
  json: { error: 'lookup ran past its 55 s budget (slow CMC or chain RPC); no verdict printed — run it again', verdict: null },
};
const stampOf = (fetchedUtc: string) => `${String(fetchedUtc).slice(0, 16).replace('T', ' ')} UTC`; // lib/format.ts utcStamp

async function refusedPlanLookup(rolling?: { window: 7; nowMs: number }) {
  const asStored = (name: string): StoredBody => {
    const f = fixture(`recorded/${name}.json`);
    return {
      endpoint: f.receipt.endpoint,
      params: f.receipt.params,
      capturedUtc: f.receipt.startedUtc,
      file: `tests/fixtures/recorded/${name}.json`,
      body: f.body,
    };
  };
  const stored = ['hist-nvda-wrappers-30d', 'rwa-quotes-nvda', 'quotes-latest-nvda', 'info-nvda-wrappers', 'rwa-assets-list-p1'].map(
    asStored,
  );
  const rwa = structuredClone(fixture('recorded/rwa-quotes-nvda.json').body);
  rwa.data.rwa_assets[0].tokens.push({
    crypto_id: NEW_ID,
    symbol: 'NVDAnew',
    name: 'A wrapper listed after the capture',
    issuer_name: 'New Issuer',
    price: 150,
    market_cap: 1e6,
    volume_24h: 1e4,
  });
  const refused = {
    httpStatus: 403,
    body: { status: { error_code: 1006, error_message: "Your API Key subscription plan doesn't support this endpoint.", credit_count: 0 } },
  };
  const rec = new Recorder(recordedTransport({ [HIST]: refused, [RWA]: { body: rwa } }), undefined, storeFrom(stored, { partial: true }));
  return lookup('NVDA', { ...(rolling ?? { from: '2026-10-22', to: '2026-11-21' }), allowLiveChain: false, rec });
}

test('refused plan (response replaced in the browser): stored wrappers keep their verdict, the capture line dates the stored bodies', async ({
  page,
}) => {
  const body = await refusedPlanLookup();
  expect(body.mode).toBe('live-stored');
  await page.route('**/api/lookup**', (r) => r.fulfill({ json: body }));
  await page.route('**/api/holders**', (r) => r.fulfill({ status: 503, json: { error: 'the holder panel is not part of this state' } }));
  await page.goto('/u/NVDA?from=2026-10-22&to=2026-11-21');

  const notice = page.locator('.notice');
  await expect(notice).toContainText('CMC no longer lets this key read part of its data');
  await expect(notice).toContainText('status.error_code 1006');
  // the line keeps "<mode> <click time>" (what e2e/judge.spec.ts binds to) and adds when the stored bodies were captured
  await expect(page.locator('p.capture').filter({ hasText: 'credits charged by CMC' })).toContainText(
    `live-stored ${stampOf(body.fetchedUtc)} (the verdict was re-run then; the stored CMC bodies were captured 2026-11-21)`,
  );
  await expect(page.getByRole('img', { name: /^Verdict: REAL INFLOW/ }).first()).toBeVisible();
  // the wrapper CMC lists now that the stored history does not hold: a row, no verdict, and the reason
  const row = page.locator('table.ledger tbody tr', { hasText: 'NVDAnew' }).first();
  await expect(row).toContainText('no verdict');
  await expect(row).toContainText('does not hold this wrapper: no verdict printed');
});

test('failed run on the home card (response replaced in the browser): the card says it still shows the earlier recorded answer', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.locator('section.card').first();
  await expect(card.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible();
  // the card opens on the pinned recorded window, which is none of the rolling-window chips: none is pressed
  const pressed = card.locator('.seg button[aria-pressed="true"]');
  await expect(card.locator('.seg button')).toHaveCount(3);
  await expect(pressed).toHaveCount(0);
  await page.route('**/api/lookup**', (r) => r.fulfill(FAILED));
  await card.getByRole('button', { name: '90 d' }).click();
  await expect(card.getByRole('alert')).toContainText('No verdict printed.');
  await expect(card).toContainText(
    /That run printed no verdict\. The card below is the earlier answer \(recorded capture \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\), not a new one\./,
  );
  await expect(pressed).toHaveCount(0); // the failed 90 d run leaves no chip pressed: the card still shows the pinned answer
  await expect(card.getByRole('img', { name: /^Verdict: / }).first()).toBeVisible();
});

test('failed run after a live-stored answer (responses replaced in the browser): the note dates the stored bodies, the chip goes back', async ({
  page,
}) => {
  // a rolling 7 d run with quotes/historical refused: lib/lookup answers it from the stored body, anchored on its last day
  const stored = await refusedPlanLookup({ window: 7, nowMs: NOW });
  expect(stored.mode).toBe('live-stored');
  expect(stored.window).toBe(7);
  let fail = false;
  await page.route('**/api/lookup**', (r) => (fail ? r.fulfill(FAILED) : r.fulfill({ json: stored })));
  await page.goto('/');
  const card = page.locator('section.card').first();
  const pressed = card.locator('.seg button[aria-pressed="true"]');
  await card.getByRole('button', { name: '7 d' }).click();
  await expect(card.locator('.notice')).toContainText('CMC no longer lets this key read part of its data');
  await expect(pressed).toHaveText('7 d');
  fail = true;
  await card.getByRole('button', { name: '90 d' }).click();
  await expect(card.getByRole('alert')).toContainText('No verdict printed.');
  // the earlier answer is a live-stored one: its figures are CMC's stored bodies, so the note carries their capture day too
  await expect(card).toContainText(
    `That run printed no verdict. The card below is the earlier answer (live-stored capture ${stampOf(stored.fetchedUtc)}, on stored CMC bodies captured 2026-11-21), not a new one.`,
  );
  await expect(pressed).toHaveText('7 d'); // back on the window of the answer the card still shows
});

test('a CMC day missing inside a verified window (response replaced in the browser): the home card says so under the proof rows', async ({
  page,
}) => {
  // lib/lookup builds the body from the recorded CMC bodies, with one interior day of NVDAB's history taken out
  const hist = structuredClone(fixture('recorded/hist-nvda-wrappers-30d.json').body);
  hist.data[NVDAB].quotes = hist.data[NVDAB].quotes.filter((q: { timestamp: string }) => !q.timestamp.startsWith('2026-10-27'));
  const body = await lookup('NVDA', {
    from: '2026-10-22',
    to: '2026-11-21',
    allowLiveChain: false,
    rec: new Recorder(recordedTransport({ [HIST]: { body: hist } })),
  });
  const nvdab = body.wrappers.find((w) => w.cryptoId === NVDAB)!;
  expect(nvdab.verdict).toBe('REAL_INFLOW');
  expect(nvdab.reason).toContain('1 missing CMC day inside the window');
  await page.route('**/api/lookup**', (r) => r.fulfill({ json: body }));
  await page.goto('/');
  const card = page.locator('section.card').first();
  await card.getByRole('button', { name: 'Run it live' }).click();
  await expect(card.locator('p.capture').filter({ hasText: 'credits charged by CMC' })).toBeVisible(); // the replaced answer is on the card
  await expect(card.getByRole('img', { name: /^Verdict: REAL INFLOW/ }).first()).toBeVisible();
  await expect(card).toContainText(
    'Inside the window CMC sent no row for 2026-10-27: the window’s supply move is chain-verified at its endpoints and largest step days, and the dollars across that day use the neighbouring days’ average price.',
  );
  await expect(card.locator('.seg button[aria-pressed="true"]')).toHaveCount(0); // a pinned run: still no rolling chip pressed
});
