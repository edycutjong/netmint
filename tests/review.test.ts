/** Regression tests for the architecture review (round 1): each pins one defect that was fixed. */
import { describe, expect, it } from 'vitest';
import { decideVerdict } from '@/lib/flow/verdict';
import { errLine } from '@/lib/flow/mintCheck';
import { isDerivative } from '@/lib/cmc/rwa';
import { citeLine } from '@/lib/cite';
import { lookup, LookupFailure, heroOf } from '@/lib/lookup';
import { Recorder } from '@/lib/receipts';
import { check, chainFrom, mirrorChain, series, recordedTransport, NOW } from './helpers';
import { addDays } from '@/lib/cmc/history';

describe('circulating guard', () => {
  it('a circulating-only release (total flat, chain flat) is NOT VERIFIABLE even with 9% of supply off the read chains', () => {
    // circulating +60,000 while total stays 1.1M: CMC moved units out of its non-circulating bucket, nothing was minted
    const s = series([1e6, 1e6, 1e6, 1e6, 1e6, 1.06e6, 1.06e6, 1.06e6, 1.06e6, 1.06e6], 190, '2026-11-01', Array(10).fill(1.1e6));
    const chain: Record<string, number> = {};
    for (let i = -3; i < 13; i++) chain[addDays('2026-11-01', i)] = 1.001e6; // coverage 0.91, flat
    const { metrics, mint } = check(s, chainFrom(chain));
    expect(mint.coverageOk).toBe(true);
    expect(mint.guardOk).toBe(false);
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('NOT_VERIFIABLE');
    expect(v.reason).toMatch(/circulating and total supply diverge/);
  });
});

describe('the reason names the bound that fired', () => {
  it('±10% of the move when that is larger than the floor', () => {
    expect(errLine(-0.01, 50_000, 500_000)).toBe('−1.0% · within remedy ±10%');
  });
  it('the 0.5%-of-supply floor when the move is small', () => {
    expect(errLine(0.2, 5_500, 10_000)).toMatch(/^\+20\.0% · within the floor ±5,500 units \(0\.5% of supply, larger than ±10% of this move\)$/);
  });
});

describe('step check at the frozen issuer offset', () => {
  it('a chain that lags CMC by one day passes at d = +1 with every step read at D + 1', () => {
    const s = series([1e6, 1e6, 1e6, 1e6, 1e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6], 190);
    const { mint } = check(s, mirrorChain(s, 1, 1), { offset: 1 });
    expect(mint.status).toBe('pass');
    expect(mint.stepDays.length).toBeGreaterThan(0);
    expect(mint.stepDays.every((x) => x.ok)).toBe(true);
  });
});

describe('FLAT keeps a failed trial visible', () => {
  it('below threshold with a chain that did not move: FLAT, and the reason says the chain check did not pass', () => {
    const s = series([1e6, 1e6, 1e6, 1.001e6, 1.001e6, 1.001e6], 100);
    const chain: Record<string, number> = {};
    for (let i = -3; i < 9; i++) chain[addDays('2026-11-01', i)] = 1e6;
    const { metrics, mint } = check(s, chainFrom(chain));
    expect(mint.status).toBe('fail');
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('FLAT');
    expect(v.reason).toMatch(/the chain check did not pass: direction check failed/);
  });
});

describe('derivative rule', () => {
  it('only the issuer label marks a derivative; market_cap 0 alone goes to trial', () => {
    expect(isDerivative({ issuer_name: 'Robinhood', market_cap: 0 })).toBe(false);
    expect(isDerivative({ issuer_name: 'NA (Derivatives)', market_cap: 12 })).toBe(true);
  });
});

describe('Cite', () => {
  it('names an unproven dollar figure as CMC supply change × price, never "net creation"', async () => {
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport()) });
    const unproven = r.wrappers.find((w) => w.metrics && w.verdict !== 'REAL_INFLOW' && w.verdict !== 'OUTFLOW')!;
    expect(citeLine(r, unproven)).toMatch(/CMC supply change × price \(unproven\)/);
    expect(citeLine(r, heroOf(r).wrapper!)).toMatch(/: net creation [+−]?\$/);
  });
});

describe('transport errors', () => {
  const throwingFor = (endpoint: string) => {
    const base = recordedTransport();
    return (async (e: string, p: Record<string, string>) => {
      if (e === endpoint) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return base(e, p);
    }) as any;
  };

  it('a quotes/historical timeout is a 503 transient failure with its own receipt, never a verdict', async () => {
    const rec = new Recorder(throwingFor('/v2/cryptocurrency/quotes/historical'));
    const e = (await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec }).catch((x) => x)) as LookupFailure;
    expect(e).toBeInstanceOf(LookupFailure);
    expect(e.httpStatus).toBe(503);
    expect((e.extra.cmcError as any).class).toBe('transient');
    const r = rec.receipts.find((x) => x.endpoint === '/v2/cryptocurrency/quotes/historical')!;
    expect(r.httpStatus).toBe(0);
    expect(r.errorMessage).toMatch(/transport error: TimeoutError/);
  });

  it('a display-only quotes/latest timeout no longer aborts the verdict', async () => {
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(throwingFor('/v2/cryptocurrency/quotes/latest')) });
    expect(heroOf(r).wrapper!.verdict).toBe('REAL_INFLOW');
    expect(r.receipts.some((x) => x.endpoint === '/v2/cryptocurrency/quotes/latest' && x.httpStatus === 0)).toBe(true);
  });
});
