/** Regression tests for the architecture review (round 2). */
import { describe, expect, it, vi } from 'vitest';
import { decideVerdict } from '@/lib/flow/verdict';
import { historySpan } from '@/lib/cmc/history';
import { findStored, storeFrom, type StoredBody } from '@/lib/stored';
import { lookup, LookupFailure } from '@/lib/lookup';
import { Recorder, BODY_CAP_BYTES } from '@/lib/receipts';
import { check, fixture, mirrorChain, series, recordedTransport, NOW } from './helpers';

const HIST = '/v2/cryptocurrency/quotes/historical';
const PLAN = {
  httpStatus: 403,
  body: { status: { error_code: 1006, error_message: "Your API Key subscription plan doesn't support this endpoint.", credit_count: 0 } },
};
const asStored = (name: string): StoredBody => {
  const f = fixture(`recorded/${name}.json`);
  return { endpoint: f.receipt.endpoint, params: f.receipt.params, capturedUtc: f.receipt.startedUtc, file: name, body: f.body };
};
const hist30 = asStored('hist-nvda-wrappers-30d');

describe('stored history: the window is never wider than the stored days', () => {
  it('a refused 90 d rolling click, against 30 d of stored days, is a 503 — not 30 days labelled 90', async () => {
    const store = storeFrom(
      ['hist-nvda-wrappers-30d', 'rwa-quotes-nvda', 'quotes-latest-nvda', 'info-nvda-wrappers', 'rwa-assets-list-p1'].map(asStored),
    );
    const rec = new Recorder(recordedTransport({ [HIST]: PLAN } as any), undefined, store);
    const e = (await lookup('NVDA', { window: 90, nowMs: NOW, allowLiveChain: false, rec }).catch((x) => x)) as LookupFailure;
    expect(e).toBeInstanceOf(LookupFailure);
    expect(e.httpStatus).toBe(503);
    expect(e.message).toMatch(/do not contain 2026-08-23 → 2026-11-21; the 7 d and 30 d windows are stored/);
  });

  it('at an equal end date the widest body wins, so a 30 d request never gets the 7 d file', () => {
    const seven: StoredBody = { ...hist30, file: 'seven', params: { ...hist30.params, time_start: '2026-11-13' } };
    const req = { ...hist30.params, time_start: '2026-10-20', time_end: '2026-11-22' }; // contained by neither → fallback sort
    expect(findStored([seven, hist30], HIST, req)?.file).toBe('hist-nvda-wrappers-30d');
    expect(findStored([hist30, seven], HIST, req)?.file).toBe('hist-nvda-wrappers-30d');
  });

  it('the stored span is computed over the requested ids only', () => {
    const body = {
      data: {
        '1': { id: 1, quotes: [{ timestamp: '2026-11-20T00:00:00.000Z', quote: { USD: {} } }] },
        '2': { id: 2, quotes: [{ timestamp: '2026-11-25T00:00:00.000Z', quote: { USD: {} } }] },
      },
    };
    expect(historySpan(body, [1])).toEqual({ first: '2026-11-20', last: '2026-11-20' });
    expect(historySpan(body, [1, 2]).last).toBe('2026-11-25');
  });

  it('a page-1 assets/list request is answered only by a stored page-1 body', () => {
    const p2: StoredBody = {
      ...asStored('rwa-assets-list-p1'),
      params: { start: '251', limit: '250' },
      capturedUtc: '2099-01-01T00:00:00Z',
    };
    expect(findStored([p2], '/v5/real-world-assets/assets/list', { start: '1', limit: '250' })).toBeNull();
    expect(
      findStored([p2, asStored('rwa-assets-list-p1')], '/v5/real-world-assets/assets/list', { start: '1', limit: '250' })?.params.start,
    ).toBe('1');
  });
});

describe('step check across a missing CMC day', () => {
  it('a step whose D−2 is a missing day is measured between the accepted points around it, never against 0', () => {
    const full = series([1e6, 1e6, 1e6, 1e6, 1.5e6, 1.5e6, 1.5e6], 190); // the move lands on 11-05
    const gapped = full.filter((p) => p.date !== '2026-11-03'); // CMC has no row for 11-03 = D−2
    const { metrics, mint } = check(gapped, mirrorChain(full));
    expect(mint.stepDays.find((s) => s.date === '2026-11-05')).toMatchObject({ cmc3d: 5e5, ok: true });
    expect(decideVerdict(metrics, mint).verdict).toBe('REAL_INFLOW');
  });
});

describe('evidence archive keeps the full body', () => {
  it('a body over the drawer cap is archived whole while the receipt carries the truncation marker', async () => {
    const big = { status: { error_code: 0, credit_count: 1 }, data: { blob: 'x'.repeat(BODY_CAP_BYTES + 10) } };
    const rec = new Recorder((async (e: string, p: Record<string, string>) => ({
      endpoint: e,
      params: p,
      method: 'GET',
      httpStatus: 200,
      ok: true,
      startedUtc: 't',
      elapsedMs: 1,
      status: big.status,
      body: big,
    })) as any);
    await rec.cmc('/v2/cryptocurrency/quotes/historical', { id: '1' });
    expect((rec.receipts[0].body as any).truncated).toBe(true);
    expect((rec.archiveBody(rec.receipts[0]) as any).data.blob.length).toBe(BODY_CAP_BYTES + 10);
  });
});

describe('a chain read that fails on the click is not a verdict', () => {
  it('wrappers whose endpoints the failed read should have supplied get no verdict and say why', async () => {
    vi.resetModules();
    vi.doMock('@/lib/chain/supply', async () => {
      const real = await vi.importActual<typeof import('@/lib/chain/supply')>('@/lib/chain/supply');
      return {
        ...real,
        legSupplies: async (...a: Parameters<typeof real.legSupplies>) => {
          const out = await real.legSupplies(a[0], a[1], a[2], { ...a[3], allowLive: false });
          for (const l of out.legs) if (l.chain === 'bsc') for (const d of l.values.keys()) l.values.set(d, null);
          return { legs: out.legs, errors: ['bsc RPC HTTP 429'] };
        },
      };
    });
    const { lookup: lk } = await import('@/lib/lookup');
    const { Recorder: R } = await import('@/lib/receipts');
    const r = await lk('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new R(recordedTransport()) });
    const nvdab = r.wrappers.find((w) => w.symbol === 'NVDAB')!; // BNB Chain only
    expect(nvdab.verdict).toBeNull();
    expect(nvdab.reason).toMatch(/^chain read failed on this click \(bsc RPC HTTP 429\); no verdict printed/);
    vi.doUnmock('@/lib/chain/supply');
  });
});
