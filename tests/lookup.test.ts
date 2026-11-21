import { describe, expect, it } from 'vitest';
import { lookup, LookupFailure, heroOf } from '@/lib/lookup';
import { Recorder, curlFor, redact, BODY_CAP_BYTES } from '@/lib/receipts';
import { parseLookupParams } from '@/lib/lookupParams';
import { parseHistoryBody } from '@/lib/cmc/history';
import { contractMapFrom } from '@/lib/cmc/info';
import { isDerivative, nearest } from '@/lib/cmc/rwa';
import { classifyCmcError } from '@/lib/cmc/errors';
import { citeLine } from '@/lib/cite';
import { fixture, NOW, recordedTransport } from './helpers';

const replay = (over = {}) => lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport(over)) });

describe('recorded replay of the 2026-11-21 NVDA 30 d capture (the critical test)', () => {
  const table = fixture('recorded/table-nvda-30d.json');

  it('reproduces the hero: NVDAB REAL INFLOW with the same net creation to the dollar', async () => {
    const r = await replay();
    const h = heroOf(r);
    expect(h.verified).toBe(true);
    expect(h.wrapper!.symbol).toBe('NVDAB');
    expect(h.wrapper!.verdict).toBe('REAL_INFLOW');
    const want = table.wrappers.find((w: any) => w.symbol === 'NVDAB').net_usd;
    expect(Math.abs(h.wrapper!.metrics!.net - want)).toBeLessThan(1); // hero shows $0.1M; we hold it to $1
    expect(h.wrapper!.metrics!.net / 1e6).toBeCloseTo(202.83, 2);
  });

  it('the hero figure equals an independent trapezoid sum over the raw recorded rows (not the code under test)', async () => {
    const rows = fixture('recorded/hist-nvda-wrappers-30d.json').body.data['40215'].quotes
      .map((q: any) => ({ d: q.timestamp.slice(0, 10), s: q.quote.USD.circulating_supply, p: q.quote.USD.price }))
      .filter((r: any) => r.d >= '2026-10-22' && r.d <= '2026-11-21');
    let net = 0;
    for (let i = 1; i < rows.length; i++) net += (rows[i].s - rows[i - 1].s) * ((rows[i].p + rows[i - 1].p) / 2);
    const h = heroOf(await replay());
    expect(Math.abs(h.wrapper!.metrics!.net - net)).toBeLessThan(1);
  });

  it('an RPC/transport error that quotes a secret is redacted before it reaches a response', async () => {
    const secret = ['alchemy', 'path', 'value', String(Date.now())].join('-');
    process.env.ALCHEMY_API_KEY = secret;
    const failing = (async () => {
      throw new Error(`fetch failed for https://bnb-mainnet.g.alchemy.com/v2/${secret}`);
    }) as any;
    const rec = new Recorder(recordedTransport(), failing);
    await rec.rpc('bsc', [{ method: 'eth_call', params: [{ to: '0x1', data: '0x18160ddd' }, '0x1'] }]).catch(() => null);
    expect(JSON.stringify(rec.receipts)).not.toContain(secret);
    expect(JSON.stringify(rec.receipts)).toContain('[REDACTED]');
  });

  it('reproduces every verdict in the captured table', async () => {
    const r = await replay();
    for (const t of table.wrappers) {
      const w = r.wrappers.find((x) => x.cryptoId === t.crypto_id)!;
      expect(w.verdict, t.symbol).toBe(t.verdict);
    }
  });

  it('stamps NVDAX (the ×3.5 headline wrapper) NOT VERIFIABLE, naming Solana and the coverage', async () => {
    const w = (await replay()).wrappers.find((x) => x.symbol === 'NVDAX')!;
    expect(w.verdict).toBe('NOT_VERIFIABLE');
    expect(w.reason).toMatch(/Solana/);
    expect(w.mint!.coverageA!).toBeLessThan(0.2);
  });

  it('proving rows: NVDAB 11-13 CMC step +406,140 vs chain +393,976 (−3.0%, within remedy), plus a mint in that day', async () => {
    const w = (await replay()).wrappers.find((x) => x.symbol === 'NVDAB')!;
    expect(w.proof!.date).toBe('2026-11-13');
    expect(Math.round(w.proof!.cmcStep)).toBe(406140);
    expect(Math.round(w.proof!.chainStep!)).toBe(393976);
    expect(w.proof!.errPct!).toBeCloseTo(-0.03, 3);
    expect(w.mintReceipt?.date).toBe('2026-11-13');
    expect(w.mintReceipt?.recipient).toBe('0x5948602680fe4aea08d98302337a2715b3aadad1');
  });

  it('greys the derivative listing (no supply to mint) and keys wrappers by id, not symbol (NVDA = 2 ids)', async () => {
    const r = await replay();
    const nv = r.wrappers.filter((w) => w.symbol === 'NVDA');
    expect(nv).toHaveLength(2);
    const d = nv.find((w) => w.derivative)!;
    expect(d.cryptoId).toBe(38153);
    expect(d.verdict).toBeNull();
    expect(r.wrappers[r.wrappers.length - 1].derivative).toBe(true);
  });

  it('records a receipt for every CMC call with credits, and never the key', async () => {
    const fake = ['fake', 'cmc', 'value', String(Date.now())].join('-'); // built at runtime: no literal key-shaped string in the repo
    process.env.CMC_API_KEY = fake;
    const r = await replay();
    expect(r.receipts.filter((x) => x.kind === 'cmc').map((x) => x.endpoint)).toEqual([
      '/v5/real-world-assets/assets/list',
      '/v5/real-world-assets/quotes/latest',
      '/v2/cryptocurrency/quotes/historical',
      '/v2/cryptocurrency/info',
      '/v2/cryptocurrency/quotes/latest',
    ]);
    expect(r.credits).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain(fake);
    expect(r.receipts[0].curl).toContain('$CMC_API_KEY');
  });

  it('a CMC plan error (verbatim 1006 body) prints no verdict and carries the verbatim error (synthetic-cmc-402)', async () => {
    const err = fixture('recorded/cmc-plan-error-1006.json').body;
    const p = replay({ '/v2/cryptocurrency/quotes/historical': { body: err, httpStatus: 403 } });
    await expect(p).rejects.toBeInstanceOf(LookupFailure);
    const e = (await p.catch((x) => x)) as LookupFailure;
    expect(e.httpStatus).toBe(502);
    expect(e.extra.cmcError).toMatchObject({ code: 1006, httpStatus: 403, message: "Your API Key subscription plan doesn't support this endpoint.", class: 'entitlement' });
    expect(JSON.stringify(e.extra)).not.toMatch(/REAL_INFLOW|OUTFLOW|RECOUNT/);
  });

  it('a 5xx is a failed run (503, transient), never a plan revert', async () => {
    const e = (await replay({ '/v2/cryptocurrency/quotes/historical': { body: { status: { error_code: 500, error_message: 'Internal' } }, httpStatus: 500 } }).catch((x) => x)) as LookupFailure;
    expect(e.httpStatus).toBe(503);
    expect((e.extra.cmcError as any).class).toBe('transient');
  });

  it('an unknown ticker is a 404 with the nearest underlyings', async () => {
    const one = fixture('recorded/rwa-assets-list-p1.json').body;
    const e = (await lookup('ZZZQ', { nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport({ '/v5/real-world-assets/assets/list': { body: { ...one, data: { ...one.data, has_more: false } } } })) }).catch((x) => x)) as LookupFailure;
    expect(e.httpStatus).toBe(404);
    expect((e.extra.suggestions as string[]).length).toBe(5);
  });

  it('a pinned window is honoured and labelled', async () => {
    const r = await lookup('NVDA', { from: '2026-11-07', to: '2026-11-14', nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport()) });
    expect(r.range).toEqual({ from: '2026-11-07', to: '2026-11-14', pinned: true });
    const w = r.wrappers.find((x) => x.symbol === 'NVDAB')!;
    expect(w.series[0].date).toBe('2026-11-07');
    expect(w.series[w.series.length - 1].date).toBe('2026-11-14');
  });

  it('the Cite line carries verdict, window, capture time, wrapper-price basis and the pinned permalink', async () => {
    const r = await replay();
    const line = citeLine(r, heroOf(r).wrapper!);
    expect(line).toMatch(/NVDAB \(bStocks\) REAL INFLOW/);
    expect(line).toMatch(/\$ at wrapper market price/);
    expect(line).toContain('/u/NVDA?from=2026-10-22&to=2026-11-21');
  });
});

describe('route contract (/api/lookup params)', () => {
  const q = (s: string) => parseLookupParams(new URLSearchParams(s));
  it('defaults to a 30 d window', () => expect(q('u=NVDA')).toMatchObject({ ok: true, window: 30 }));
  it('rejects bad windows, bad tickers, half-pinned and reversed ranges', () => {
    expect(q('u=NVDA&window=8').ok).toBe(false);
    expect(q('u=').ok).toBe(false);
    expect(q('u=NV<script>').ok).toBe(false);
    expect(q('u=NVDA&from=2026-11-01').ok).toBe(false);
    expect(q('u=NVDA&from=2026-11-10&to=2026-11-01').ok).toBe(false);
    expect(q('u=NVDA&from=2026-01-01&to=2026-11-01').ok).toBe(false);
  });
  it('a pinned and a rolling request never share a de-dupe key', () => {
    const a = q('u=NVDA&window=30') as any, b = q('u=NVDA&from=2026-10-22&to=2026-11-21') as any;
    expect(a.key).not.toBe(b.key);
    expect((q('u=nvda') as any).key).toBe((q('u=NVDA&window=30') as any).key);
  });
});

describe('CMC parsing + receipts', () => {
  it('parses single-id and multi-id history bodies', () => {
    const multi = parseHistoryBody(fixture('recorded/hist-nvda-wrappers-30d.json').body);
    expect(multi.get(40215)!.length).toBeGreaterThan(25);
    const single = parseHistoryBody({ data: { id: 1, quotes: [{ timestamp: '2026-11-01T00:00:00Z', quote: { USD: { price: 1, circulating_supply: 2, total_supply: 2 } } }] } });
    expect(single.get(1)![0].circulating_supply).toBe(2);
  });
  it('maps contracts to readable legs and lists the rest as unreadable (NVDAX)', () => {
    const info = fixture('recorded/info-nvda-wrappers.json').body.data;
    const m = contractMapFrom(info['36992']);
    expect(m.legs.map((l) => l.chain).sort()).toEqual(['bsc', 'eth']);
    expect(m.unreadable).toContain('Solana');
  });
  it('flags derivative listings', () => {
    expect(isDerivative({ issuer_name: 'NA (Derivatives)', market_cap: 0 })).toBe(true);
    expect(isDerivative({ issuer_name: 'bStocks', market_cap: 2e8 })).toBe(false);
  });
  it('suggests nearest tickers', () => {
    expect(nearest('NVDQ', [{ rwa_id: 2, symbol: 'NVDA', name: '' }, { rwa_id: 3, symbol: 'AAPL', name: '' }])[0]).toBe('NVDA');
  });
  it('classifies CMC errors: entitlement vs transient vs config', () => {
    expect(classifyCmcError(1006, 403)).toBe('entitlement');
    expect(classifyCmcError(1010, 429)).toBe('entitlement');
    expect(classifyCmcError(1008, 429)).toBe('transient');
    expect(classifyCmcError(0, 502)).toBe('transient');
    expect(classifyCmcError(1002, 401)).toBe('config');
  });
  it('redacts secrets and builds a curl with the $CMC_API_KEY placeholder', () => {
    expect(redact('a SECRETSECRET b', ['SECRETSECRET'])).toBe('a [REDACTED] b');
    expect(curlFor('/v1/key/info', {})).toBe('curl -s -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v1/key/info"');
    expect(BODY_CAP_BYTES).toBeLessThan(1_000_000);
  });
});
