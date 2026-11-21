import { describe, expect, it } from 'vitest';
import { sanityGuard } from '@/lib/flow/sanity';
import { netCreation, diverges } from '@/lib/flow/netCreation';
import { decideVerdict, flatThreshold } from '@/lib/flow/verdict';
import { PARAMS } from '@/lib/flow/params';
import { addDays } from '@/lib/cmc/history';
import { check, chainFrom, mirrorChain, raw, series } from './helpers';

describe('sanity guard', () => {
  it('refuses a 1e42 supply row and a price-0 row, lists both, computes on the rest (synthetic-artefact-1e42)', () => {
    const rows = raw([
      { date: '2026-11-01', price: 100, circulating_supply: 1000 },
      { date: '2026-11-02', price: 100, circulating_supply: 1e42 },
      { date: '2026-11-03', price: 0, circulating_supply: 1000 },
      { date: '2026-11-04', price: 100, circulating_supply: 1100 },
    ]);
    const g = sanityGuard(rows);
    expect(g.refused.map((r) => r.reason)).toEqual(['magnitude', 'price_nonpositive']);
    expect(g.accepted.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-04']);
    expect(netCreation(g.accepted)!.supplyDelta).toBe(100);
  });

  it('refuses a spike that reverts the next day (synthetic-spike-revert: +500% then −83%)', () => {
    const g = sanityGuard(raw([
      { date: '2026-11-01', price: 10, circulating_supply: 1000 },
      { date: '2026-11-02', price: 10, circulating_supply: 6000 },
      { date: '2026-11-03', price: 10, circulating_supply: 1020 },
    ]));
    expect(g.refused).toHaveLength(1);
    expect(g.refused[0]).toMatchObject({ date: '2026-11-02', reason: 'spike_revert' });
  });

  it('keeps a one-way step (that is a chain-check case, not a guard case: the Backed 2026-07-31 drop)', () => {
    const g = sanityGuard(raw([
      { date: '2026-07-30', price: 170, circulating_supply: 659169 },
      { date: '2026-07-31', price: 170, circulating_supply: 178275 },
      { date: '2026-08-01', price: 170, circulating_supply: 178323 },
    ]));
    expect(g.refused).toHaveLength(0);
    expect(g.accepted).toHaveLength(3);
  });

  it('refuses duplicates, missing price, missing supply and lists unexplained gaps', () => {
    const g = sanityGuard(raw([
      { date: '2026-11-01', price: 1, circulating_supply: 10 },
      { date: '2026-11-01', price: 1, circulating_supply: 10 },
      { date: '2026-11-02', price: undefined, circulating_supply: 10 },
      { date: '2026-11-03', price: 1, circulating_supply: 0 },
      { date: '2026-11-06', price: 1, circulating_supply: 11 },
    ]));
    const reasons = g.refused.map((r) => r.reason);
    expect(reasons).toContain('duplicate');
    expect(reasons).toContain('price_missing');
    expect(reasons).toContain('supply_missing');
    expect(g.refused.filter((r) => r.reason === 'gap').map((r) => r.date)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('never drops silently: accepted + refused raw rows = raw rows', () => {
    const rows = raw(Array.from({ length: 20 }, (_, i) => ({ date: addDays('2026-10-01', i), price: i % 7 === 3 ? 0 : 10 + i, circulating_supply: i === 9 ? 2e13 : 1000 + i })));
    const g = sanityGuard(rows);
    expect(g.accepted.length + g.refused.filter((r) => r.raw !== null).length).toBe(rows.length);
  });

  it('treats total_supply ≤ 0 as null (NBISB total_supply 0)', () => {
    const g = sanityGuard(raw([{ date: '2026-11-01', price: 5, circulating_supply: 134344, total_supply: 0 }]));
    expect(g.accepted[0].totalSupply).toBeNull();
  });
});

describe('net creation (trapezoid price)', () => {
  it('computes ΔS × average price, gross in/out, units × and price %', () => {
    const m = netCreation(series([100, 150, 120], [10, 20, 30]))!;
    // +50 × 15 = 750 ; −30 × 25 = −750
    expect(m.flows.map((f) => f.flow)).toEqual([750, -750]);
    expect(m.net).toBe(0);
    expect(m.grossIn).toBe(750);
    expect(m.grossOut).toBe(-750);
    expect(m.unitsX).toBeCloseTo(1.2);
    expect(m.pricePct).toBeCloseTo(2);
  });

  it('needs two points', () => {
    expect(netCreation(series([100], 1))).toBeNull();
  });

  it('flags quoted-vs-flow divergence (price down, money in)', () => {
    const m = netCreation(series([100, 200, 300], [10, 9, 8]))!;
    expect(diverges(m, 1000)).toBe(true);
    expect(diverges(m, 1e9)).toBe(false);
  });
});

/** 10-day series with one big step on day 5; price falls (like NVDAB). */
const big = () => series([1e6, 1e6, 1e6, 1e6, 1e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6], [200, 198, 196, 194, 192, 190, 188, 186, 184, 182]);

describe('mint check + verdict (one test per state)', () => {
  it('REAL INFLOW: chain mirrors CMC within remedy at the frozen d', () => {
    const s = big();
    const { metrics, mint } = check(s, mirrorChain(s, 0.99));
    expect(mint.status).toBe('pass');
    expect(decideVerdict(metrics, mint).verdict).toBe('REAL_INFLOW');
    expect(mint.reason).toMatch(/steps carrying ≥ 80% of the flow verified within remedy/);
    expect(mint.reason).not.toMatch(/every step verified/);
  });

  it('OUTFLOW: verified net redemption', () => {
    const s = series([1.5e6, 1.5e6, 1.5e6, 1e6, 1e6, 1e6], 100);
    const { metrics, mint } = check(s, mirrorChain(s));
    expect(decideVerdict(metrics, mint).verdict).toBe('OUTFLOW');
  });

  it('RECOUNT: chain legs held flat across the step (synthetic-recount)', () => {
    const s = big();
    const flat = chainFrom(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [addDays('2026-10-29', i), 1e6])));
    const { metrics, mint } = check(s, flat);
    expect(mint.status).toBe('fail');
    expect(decideVerdict(metrics, mint).verdict).toBe('RECOUNT');
  });

  it('RECOUNT: wrong direction (CMC +8%, chain −1%, cov 0.99, no unreadable leg)', () => {
    const s = series([1e7, 1e7, 1e7, 1.08e7, 1.08e7], 100);
    const m: Record<string, number> = {};
    for (let i = -3; i < 8; i++) m[addDays('2026-11-01', i)] = i < 3 ? 0.99e7 : 0.98e7;
    const { metrics, mint } = check(s, chainFrom(m));
    expect(mint.coverageA).toBeCloseTo(0.99);
    expect(decideVerdict(metrics, mint).verdict).toBe('RECOUNT');
  });

  it('NOT VERIFIABLE: residual dominance — +6% step, legs flat, cov 0.91, Solana leg (never INFLOW, never RECOUNT)', () => {
    const s = series([1e7, 1e7, 1e7, 1.06e7, 1.06e7], 100);
    const flat = chainFrom(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [addDays('2026-10-28', i), 0.91e7])));
    const { metrics, mint } = check(s, flat, { unreadable: ['Solana'] });
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('NOT_VERIFIABLE');
    expect(v.reason).toMatch(/may sit on Solana/);
  });

  it('NOT VERIFIABLE: ambiguous alignment — fails at the frozen d, passes at another single offset', () => {
    // 85% of the move mid-window (the 3-day sum absorbs a 1-day lag), 15% on the last day (only d = +1 sees it)
    const s = series([1e6, 1e6, 1e6, 1.85e6, 1.85e6, 1.85e6, 2e6], 100);
    const { metrics, mint } = check(s, mirrorChain(s, 1, 1), { offset: 0 });
    const v = decideVerdict(metrics, mint);
    expect(mint.status).toBe('ambiguous');
    expect(mint.altOffset).toBe(1);
    expect(v.verdict).toBe('NOT_VERIFIABLE');
    expect(v.reason).toMatch(/alignment ambiguous/);
  });

  it('NOT VERIFIABLE: dollar net and supply move disagree (units created cheap, redeemed dear)', () => {
    const s = series([1e6, 1.05e6, 1.05e6, 1.008e6], [10, 10, 100, 100]);
    const { metrics, mint } = check(s, mirrorChain(s));
    expect(metrics.supplyDelta).toBeGreaterThan(0);
    expect(metrics.net).toBeLessThan(0);
    expect(decideVerdict(metrics, mint).verdict).toBe('NOT_VERIFIABLE');
    expect(decideVerdict(metrics, mint).reason).toMatch(/dollar net and supply move disagree/);
  });

  it('NOT VERIFIABLE: most supply off the readable chains (coverage below 0.90)', () => {
    const s = big();
    const { metrics, mint } = check(s, mirrorChain(s, 0.145), { unreadable: ['Solana'] });
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('NOT_VERIFIABLE');
    expect(v.reason).toMatch(/86% of supply sits outside BNB Chain \+ Ethereum \(Solana\)/);
  });

  it('NOT VERIFIABLE: chain and CMC disagree on the level (coverage above 1.10)', () => {
    const s = big();
    const { mint } = check(s, mirrorChain(s, 1.3));
    expect(mint.status).toBe('impossible');
    expect(mint.reason).toMatch(/disagree on the level/);
  });

  it('NOT VERIFIABLE: no contract on a readable chain', () => {
    const s = big();
    const { metrics, mint } = check(s, () => null, { legs: [], unreadable: ['Arbitrum'] });
    expect(decideVerdict(metrics, mint).reason).toMatch(/listed on Arbitrum/);
  });

  it('NOT VERIFIABLE: chain data unavailable is never INFLOW', () => {
    const s = big();
    const { metrics, mint } = check(s, () => null);
    expect(decideVerdict(metrics, mint)).toMatchObject({ verdict: 'NOT_VERIFIABLE' });
    expect(mint.reason).toMatch(/chain check unavailable/);
  });

  it('NOT VERIFIABLE: circulating and total diverge (the Backed 07-31 split: circulating −73%, total +45%)', () => {
    const s = series([659169, 659169, 178275, 178323], 170, '2026-07-29', [659169, 659169, 953132, 953132]);
    const { metrics, mint } = check(s, mirrorChain(s));
    expect(mint.guardOk).toBe(false);
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('NOT_VERIFIABLE');
    expect(v.reason).toMatch(/circulating and total supply diverge/);
  });

  it('FLAT: under the threshold with coverage 0.91, drawn unproven (synthetic-flat-partial-coverage)', () => {
    const s = series([10000, 10000, 10100, 10100], 20);
    const { metrics, mint } = check(s, mirrorChain(s, 0.91), { unreadable: ['Solana'] });
    const v = decideVerdict(metrics, mint);
    expect(v.verdict).toBe('FLAT');
    expect(v.reason).toMatch(/not put to trial/);
    expect(v.reason).not.toMatch(/verified/);
  });

  it('FLAT threshold is max($250k, 2% of market cap at A)', () => {
    expect(flatThreshold(netCreation(series([100, 101], 10))!)).toBe(PARAMS.flatUsd);
    expect(flatThreshold(netCreation(series([1e7, 1e7], 100))!)).toBe(0.02 * 1e9);
  });

  it('no verdict with fewer than 2 points', () => {
    expect(decideVerdict(null, null).verdict).toBeNull();
  });

  it('a step outside remedy fails the step check even when the endpoints agree', () => {
    const s = series([1e6, 1e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6], 100);
    // chain arrives at the same end level but 4 days late: endpoints agree, the material step does not
    const m: Record<string, number> = {};
    for (let i = -3; i < 12; i++) m[addDays('2026-11-01', i)] = i >= 6 ? 1.5e6 : 1e6;
    const { mint } = check(s, chainFrom(m));
    expect(mint.windowOk).toBe(true);
    expect(mint.stepOk).toBe(false);
    expect(mint.status).not.toBe('pass');
  });

  it('direction check binds when the 0.005 floor passes the window but the chain moved < 75% of CMC', () => {
    // CMC +0.4% of a 1e8 supply; chain +0.2%: |err| = 200k ≤ floor 502k, but 0.2 < 0.75 × 0.4
    const s = series([1e8, 1e8, 1.004e8, 1.004e8], 100);
    const m: Record<string, number> = {};
    for (let i = -3; i < 8; i++) m[addDays('2026-11-01', i)] = i >= 2 ? 1.002e8 : 1e8;
    const { metrics, mint } = check(s, chainFrom(m));
    expect(mint.windowOk).toBe(true);
    expect(mint.directionOk).toBe(false);
    expect(mint.status).not.toBe('pass');
    // a move inside the 0.5% floor is under the 2%-of-market-cap FLAT bar, so the stamp is FLAT (never REAL INFLOW)
    expect(decideVerdict(metrics, mint).verdict).toBe('FLAT');
  });

  it('FLAT wins over a step-day data hole when coverage is in bounds (FLAT needs no step match)', () => {
    const s = series([10000, 10000, 10100, 10100, 10100, 10100], 20); // net $2,000, step on day 2
    const full = mirrorChain(s);
    const holed = (d: string) => (d === s[3].date ? null : full(d)); // D+1 of the step day; endpoints intact
    const { metrics, mint } = check(s, holed);
    expect(mint.status).toBe('impossible');
    expect(mint.coverageOk).toBe(true);
    expect(decideVerdict(metrics, mint).verdict).toBe('FLAT');
  });

  it('uses circulating supply for the whole window when any day lacks total_supply (no NaN step sums)', () => {
    const s = big();
    s[4] = { ...s[4], totalSupply: null };
    const { mint } = check(s, mirrorChain(s));
    expect(mint.comparator).toBe('circulating_supply');
    expect(mint.stepDays.every((d) => Number.isFinite(d.cmc3d))).toBe(true);
    expect(mint.status).toBe('pass');
  });

  it('NOT VERIFIABLE (never RECOUNT) when the chain is missing on a material step day', () => {
    const s = big();
    const full = mirrorChain(s);
    const holed = (d: string) => (d === s[6].date ? null : full(d)); // D+1 of the step day
    const { metrics, mint } = check(s, holed);
    expect(mint.status).toBe('impossible');
    expect(decideVerdict(metrics, mint).verdict).toBe('NOT_VERIFIABLE');
  });

  it('a step-check failure is never rescued by another offset (steps are not shifted by d)', () => {
    const s = series([1e6, 1e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6], 100);
    const m: Record<string, number> = {};
    for (let i = -3; i < 12; i++) m[addDays('2026-11-01', i)] = i >= 6 ? 1.5e6 : 1e6;
    const { metrics, mint } = check(s, chainFrom(m));
    expect(mint.altOffsetPasses).toBe(false);
    expect(decideVerdict(metrics, mint).verdict).toBe('RECOUNT');
  });

  it('invariant: REAL INFLOW / OUTFLOW only with a passed mint check, over many random chains', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 300; n++) {
      const sup = [1e6];
      for (let i = 1; i < 10; i++) sup.push(sup[i - 1] * (1 + (rnd() - 0.4) * 0.3));
      const s = series(sup, sup.map(() => 50 + rnd() * 100));
      const k = 0.85 + rnd() * 0.3;
      const noise: Record<string, number> = {};
      for (let i = -3; i < 13; i++) noise[addDays('2026-11-01', i)] = sup[Math.min(Math.max(i, 0), 9)] * k * (1 + (rnd() - 0.5) * 0.2);
      const { metrics, mint } = check(s, chainFrom(noise), { unreadable: rnd() < 0.3 ? ['Solana'] : [] });
      const v = decideVerdict(metrics, mint).verdict;
      if (v === 'REAL_INFLOW' || v === 'OUTFLOW') {
        expect(mint.status).toBe('pass');
        expect(mint.guardOk).toBe(true);
        expect(Math.sign(metrics.net)).toBe(Math.sign(metrics.supplyDelta));
      }
      if (v === 'RECOUNT') {
        expect(mint.unreadableLeg).toBe(false);
        expect(mint.altOffsetPasses).toBe(false);
        expect(mint.outsideSupplyA!).toBeLessThan(0.25 * Math.abs(mint.cmcDelta!));
      }
      if (v === 'FLAT') expect(mint.coverageA! >= 0.9 && mint.coverageA! <= 1.1).toBe(true);
    }
  });
});
