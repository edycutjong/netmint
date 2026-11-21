import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { divergenceOf, loadFlows, rowsFromLookup, sortFlows, type FlowRow, type FlowsTable } from '@/lib/flows';
import { lookup } from '@/lib/lookup';
import { Recorder } from '@/lib/receipts';
import { holders, mintRecipientOf, sumHolders } from '@/lib/holders';
import { HOLDER_PLATFORM } from '@/lib/cmc/holders';
import { NOW, recordedTransport } from './helpers';
import type { CmcCall } from '@/lib/cmc/client';

const row = (o: Partial<FlowRow>): FlowRow => ({
  underlying: 'X',
  rwaId: 1,
  cryptoId: 1,
  symbol: 'X',
  issuer: 'I',
  verdict: 'FLAT',
  reason: '',
  netUsd: 0,
  unitsX: 1,
  pricePct: 0,
  coverage: 1,
  marketCap: 1,
  exitRatio: 0,
  divergence: null,
  evidence: 'e',
  ...o,
});

describe('/flows leaderboard (views of the same lookup)', () => {
  it('flags price-vs-money disagreement only for chain-verified moves', () => {
    expect(divergenceOf('REAL_INFLOW', -0.2)).toBe('price_down_money_in');
    expect(divergenceOf('OUTFLOW', 0.06)).toBe('price_up_money_out');
    expect(divergenceOf('REAL_INFLOW', 0.2)).toBeNull(); // money and price agree
    expect(divergenceOf('OUTFLOW', -0.5)).toBeNull();
    expect(divergenceOf('RECOUNT', -0.4)).toBeNull(); // unproven moves are never called a divergence
    expect(divergenceOf('NOT_VERIFIABLE', -0.4)).toBeNull();
    expect(divergenceOf('REAL_INFLOW', null)).toBeNull();
  });

  it('ranks verified moves first by |net|, then RECOUNT, NOT VERIFIABLE, FLAT, no verdict', () => {
    const rows = sortFlows([
      row({ symbol: 'NV', verdict: 'NOT_VERIFIABLE', netUsd: 9e9 }),
      row({ symbol: 'NONE', verdict: null, netUsd: null }),
      row({ symbol: 'OUT', verdict: 'OUTFLOW', netUsd: -5e6 }),
      row({ symbol: 'IN', verdict: 'REAL_INFLOW', netUsd: 2e6 }),
      row({ symbol: 'RC', verdict: 'RECOUNT', netUsd: 7e7 }),
      row({ symbol: 'FL', verdict: 'FLAT', netUsd: 1 }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OUT', 'IN', 'RC', 'NV', 'FL', 'NONE']);
  });

  it('flattens a recorded lookup: NVDAB is the REAL INFLOW row with its divergence; derivative listings are dropped', async () => {
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport()) });
    const rows = rowsFromLookup(r, 'evidence/2026-11-21/flows/nvda-30d');
    expect(rows.length).toBe(r.wrappers.filter((w) => !w.derivative).length);
    const b = rows.find((x) => x.symbol === 'NVDAB')!;
    expect(b.verdict).toBe('REAL_INFLOW');
    expect(b.netUsd! / 1e6).toBeCloseTo(202.83, 2);
    expect(b.divergence).toBe('price_down_money_in'); // price −41%, money in
    expect(rows.every((x) => x.evidence === 'evidence/2026-11-21/flows/nvda-30d')).toBe(true);
  });

  it('loadFlows reads the newest committed table for the window and returns null when none exists', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nm-flows-'));
    expect(loadFlows(30, root)).toBeNull();
    const t = (d: string, w: 7 | 30): FlowsTable => ({
      generatedUtc: `${d}T00:00:00Z`,
      command: 'c',
      window: w,
      range: { from: 'a', to: 'b' },
      universe: { underlyings: 1, wrappers: 0, ranking: 'r' },
      credits: 0,
      skipped: [],
      rows: [],
    });
    for (const [d, w] of [
      ['2026-11-21', 30],
      ['2026-11-25', 30],
      ['2026-11-25', 7],
    ] as const) {
      mkdirSync(path.join(root, 'evidence', d), { recursive: true });
      writeFileSync(path.join(root, 'evidence', d, `flows-${w}d.json`), JSON.stringify(t(d, w)));
    }
    expect(loadFlows(30, root)!.generatedUtc).toBe('2026-11-25T00:00:00Z');
    expect(loadFlows(7, root)!.window).toBe(7);
  });
});

describe('holder panel', () => {
  const countBody = (n: number) => ({
    data: { platformId: 1, count: String(n), tokenAddress: '0x' },
    status: { timestamp: 't', error_code: '0', error_message: '', elapsed: 1, credit_count: 1 },
  });

  it('uses CMC platform names (eth is rejected by CMC, ethereum works)', () => {
    expect(HOLDER_PLATFORM).toEqual({ bsc: 'bsc', eth: 'ethereum' });
  });

  it('sums the answering legs only and says n/a when none answered', () => {
    expect(
      sumHolders([
        { chain: 'bsc', address: 'a', count: 10, error: null },
        { chain: 'eth', address: 'b', count: null, error: 'x' },
        { chain: 'eth', address: 'c', count: 5, error: null },
      ]),
    ).toBe(15);
    expect(sumHolders([{ chain: 'bsc', address: 'a', count: null, error: 'x' }])).toBeNull();
    expect(sumHolders([])).toBeNull();
  });

  it('mint recipient is the latest committed receipt of that wrapper, else null', () => {
    const m = (date: string, recipient: string) => ({
      crypto_id: 7,
      symbol: 'S',
      chain: 'bsc' as const,
      date,
      tx: '0x',
      block: 1,
      amount: 1,
      recipient,
      explorer_url: 'u',
    });
    expect(mintRecipientOf(7, [m('2026-11-01', 'old'), m('2026-11-13', 'new')])!.recipient).toBe('new');
    expect(mintRecipientOf(8, [m('2026-11-01', 'old')])).toBeNull();
  });

  it('one holders/count call per readable leg, a failing leg is shown unavailable (never zero), credits add up', async () => {
    const base = recordedTransport();
    const t = async function <T>(endpoint: string, params: Record<string, string> = {}): Promise<CmcCall<T>> {
      if (endpoint !== '/v1/dex/holders/count') return base<T>(endpoint, params);
      const bad = params.platform === 'ethereum';
      const body = bad ? { status: { timestamp: 't', error_code: '1006', error_message: 'plan', credit_count: 0 } } : countBody(1234);
      return {
        endpoint,
        params,
        method: 'GET',
        httpStatus: bad ? 403 : 200,
        ok: !bad,
        startedUtc: 't',
        elapsedMs: 1,
        status: (body as any).status,
        body: body as T,
      };
    };
    const r = await holders('NVDA', { rec: new Recorder(t as any) });
    const calls = r.receipts.filter((x) => x.endpoint === '/v1/dex/holders/count');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => ['bsc', 'ethereum'].includes(c.params.platform))).toBe(true);
    const onlyBsc = r.rows.find((x) => x.legs.length && x.legs.every((l) => l.chain === 'bsc'))!;
    expect(onlyBsc.total).toBe(1234);
    const withEth = r.rows.find((x) => x.legs.some((l) => l.chain === 'eth'));
    if (withEth) {
      const eth = withEth.legs.find((l) => l.chain === 'eth')!;
      expect(eth.count).toBeNull();
      expect(eth.error).toMatch(/1006/);
    }
    expect(r.credits).toBe(
      calls.filter((c) => c.httpStatus === 200).length * 1 +
        r.receipts.filter((x) => x.endpoint !== '/v1/dex/holders/count').reduce((s, x) => s + (x.creditCount ?? 0), 0),
    );
  });
});
