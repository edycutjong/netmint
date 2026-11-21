/**
 * The live-stored path: what the judged URL does after the event key reverts to CMC's Basic plan.
 * A classified ENTITLEMENT refusal (1006 "plan doesn't support this endpoint") is answered from a committed
 * body; a 5xx / timeout / rate limit is a failed run and never falls back.
 */
import { describe, expect, it } from 'vitest';
import { lookup, LookupFailure, heroOf } from '@/lib/lookup';
import { Recorder } from '@/lib/receipts';
import { findStored, loadStoredIndex, storeFrom, type StoredBody } from '@/lib/stored';
import { fixture, NOW, recordedTransport } from './helpers';

const HIST = '/v2/cryptocurrency/quotes/historical';
const LATEST = '/v2/cryptocurrency/quotes/latest';
// verbatim documented body for 1006 (docs/proof/spike/plan-errors.json)
const PLAN = {
  httpStatus: 403,
  body: { status: { error_code: 1006, error_message: "Your API Key subscription plan doesn't support this endpoint.", credit_count: 0 } },
};
const KEY_INFO = { body: { status: { error_code: 0, credit_count: 0 }, data: { plan: { credit_limit_monthly: 15000 } } } };

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
const BODIES = ['hist-nvda-wrappers-30d', 'rwa-quotes-nvda', 'quotes-latest-nvda', 'info-nvda-wrappers', 'rwa-assets-list-p1'].map(
  asStored,
);
const store = storeFrom(BODIES);
const run = (over: Record<string, unknown>, opts: Record<string, unknown> = {}, u = 'NVDA') =>
  lookup(u, {
    window: 30,
    nowMs: NOW,
    allowLiveChain: false,
    rec: new Recorder(recordedTransport({ '/v1/key/info': KEY_INFO, ...over } as any), undefined, store),
    ...opts,
  });

describe('live-stored: a plan-refused quotes/historical is answered from the committed body', () => {
  it('re-runs the verdict over the stored series and reproduces the live hero to the dollar', async () => {
    const live = heroOf(await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport()) }));
    const r = await run({ [HIST]: PLAN });
    expect(r.mode).toBe('live-stored');
    expect(r.live).toBe(false);
    expect(r.liveCmcCalls).toContain(LATEST);
    expect(r.liveCmcCalls).not.toContain(HIST);
    expect(r.stored!.map((s) => s.endpoint)).toEqual([HIST]);
    expect(r.stored![0].liveError.code).toBe(1006);
    const h = heroOf(r);
    expect(h.wrapper!.symbol).toBe(live.wrapper!.symbol);
    expect(h.wrapper!.verdict).toBe(live.wrapper!.verdict);
    expect(Math.abs(h.wrapper!.metrics!.net - live.wrapper!.metrics!.net)).toBeLessThan(1);
  });

  it('keeps both receipts: the verbatim refusal and the stored body (0 credits, file + capture time)', async () => {
    const r = await run({ [HIST]: PLAN });
    const hist = r.receipts.filter((x) => x.endpoint === HIST);
    expect(hist).toHaveLength(2);
    expect(hist[0].errorCode).toBe(1006);
    expect(hist[0].stored).toBeUndefined();
    expect(hist[1].stored).toEqual({
      file: 'tests/fixtures/recorded/hist-nvda-wrappers-30d.json',
      capturedUtc: '2026-11-21T01:40:10.925Z',
    });
    expect(hist[1].creditCount).toBe(0);
  });

  it('when every data call is refused, the click still makes one live CMC call: /v1/key/info', async () => {
    const all = ['/v5/real-world-assets/assets/list', '/v5/real-world-assets/quotes/latest', '/v2/cryptocurrency/info', LATEST, HIST];
    const r = await run(Object.fromEntries(all.map((e) => [e, PLAN])));
    expect(r.mode).toBe('live-stored');
    expect(r.liveCmcCalls).toEqual(['/v1/key/info']);
    expect(r.stored!.map((s) => s.endpoint).sort()).toEqual([...all].sort());
    expect(heroOf(r).wrapper!.verdict).toBe('REAL_INFLOW');
  });

  it('a rolling window after the stored history ends is re-anchored on its last day, never padded to today', async () => {
    const r = await run({ [HIST]: PLAN }, { nowMs: Date.parse('2026-12-15T09:00:00Z') });
    expect(r.range.to).toBe('2026-11-21');
    expect(r.range.from).toBe('2026-10-22');
    expect(r.history).toEqual({ source: 'stored', lastDay: '2026-11-21', capturedUtc: '2026-11-21T01:40:10.925Z' });
  });

  it('a pinned window outside the stored body is a 503 with the verbatim refusal, never a verdict', async () => {
    const e = (await run({ [HIST]: PLAN }, { from: '2026-11-20', to: '2026-12-05', window: undefined }).catch((x) => x)) as LookupFailure;
    expect(e).toBeInstanceOf(LookupFailure);
    expect(e.httpStatus).toBe(503);
    expect(e.message).toContain('error_code 1006');
    expect(e.message).toContain('do not contain');
  });

  it('a pinned window inside the stored body is answered live-stored', async () => {
    const r = await run({ [HIST]: PLAN }, { from: '2026-11-07', to: '2026-11-14', window: undefined });
    expect(r.mode).toBe('live-stored');
    expect(r.range).toEqual({ from: '2026-11-07', to: '2026-11-14', pinned: true });
  });

  it('a ticker outside the stored universe after the revert is a 503 that says so', async () => {
    const e = (await run({ '/v5/real-world-assets/quotes/latest': PLAN }, {}, 'AAPL').catch((x) => x)) as LookupFailure;
    expect(e.httpStatus).toBe(503);
    expect(e.message).toContain('outside the stored universe');
    expect((e.extra.cmcError as any).code).toBe(1006);
  });

  it('a 5xx, a minute rate limit or a timeout-shaped error never falls back to stored bodies', async () => {
    for (const bad of [
      { httpStatus: 500, body: { status: { error_code: 0, error_message: 'Internal error' } } },
      { httpStatus: 429, body: { status: { error_code: 1008, error_message: "You've exceeded your API Key's HTTP request rate limit." } } },
      { httpStatus: 0, body: 'network timeout' },
    ]) {
      const e = (await run({ [HIST]: bad }).catch((x) => x)) as LookupFailure;
      expect(e).toBeInstanceOf(LookupFailure);
      expect(e.httpStatus).toBe(503);
      expect((e.extra.receipts as any[]).some((x) => x.stored)).toBe(false);
    }
  });

  it('without a store (every capture script) a plan refusal stays a 502 with the verbatim error', async () => {
    const e = (await lookup('NVDA', {
      window: 30,
      nowMs: NOW,
      allowLiveChain: false,
      rec: new Recorder(recordedTransport({ [HIST]: PLAN } as any)),
    }).catch((x) => x)) as LookupFailure;
    expect(e.httpStatus).toBe(502);
    expect((e.extra.cmcError as any).code).toBe(1006);
  });

  it('the live-stored response stays under 1 MB', async () => {
    const r = await run({ [HIST]: PLAN });
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(1_000_000);
  });
});

describe('findStored / loadStoredIndex', () => {
  it('matches id-keyed bodies on a superset of ids and refuses a missing id', () => {
    const ids = BODIES[0].params.id.split(',');
    expect(findStored(BODIES, LATEST, { id: ids.slice(0, 2).join(',') })?.file).toContain('quotes-latest-nvda');
    expect(findStored(BODIES, LATEST, { id: `${ids[0]},999999` })).toBeNull();
  });

  it('serves assets/list for page 1 only', () => {
    expect(findStored(BODIES, '/v5/real-world-assets/assets/list', { start: '1', limit: '100' })).not.toBeNull();
    expect(findStored(BODIES, '/v5/real-world-assets/assets/list', { start: '101', limit: '100' })).toBeNull();
  });

  it('prefers a history body that contains the request, else the latest-ending one', () => {
    const older: StoredBody = {
      ...BODIES[0],
      params: { ...BODIES[0].params, time_start: '2026-10-01', time_end: '2026-11-01' },
      file: 'older',
    };
    const p = { ...BODIES[0].params, time_start: '2026-11-05', time_end: '2026-11-12' };
    expect(findStored([older, BODIES[0]], HIST, p)?.file).toContain('hist-nvda');
    expect(findStored([older, BODIES[0]], HIST, { ...p, time_end: '2026-12-10' })?.file).toContain('hist-nvda');
  });

  it('the committed evidence indexes only successful CMC bodies, newest first, incl. history for the NVDA wrappers', () => {
    const idx = loadStoredIndex();
    expect(idx.length).toBeGreaterThan(50);
    expect(idx.some((s) => s.endpoint === HIST && s.params.id.includes('40215'))).toBe(true);
    for (let i = 1; i < idx.length; i++) expect(idx[i - 1].capturedUtc >= idx[i].capturedUtc).toBe(true);
  });
});
