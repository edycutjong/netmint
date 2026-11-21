/**
 * Mint check (complexity §4.1): CMC's supply move over [A, B] put to trial against the summed on-chain
 * totalSupply of every readable leg (BNB Chain + Ethereum) at day-boundary blocks. Pure: chain values come in
 * through `chainAt`, so the same code runs live, on the committed baseline and on recorded fixtures.
 */
import { PARAMS, type Offset } from './params';
import { addDays } from '../cmc/history';
import type { ChainLeg, DailyPoint, FlowMetrics, MintCheck, StepDay } from '../types';

export interface MintInput {
  series: DailyPoint[]; // accepted points, A = first, B = last
  flows: FlowMetrics['flows'];
  chainAt: (date: string) => number | null; // Σ legs totalSupply at block_at(date); null = not available
  legs: ChainLeg[];
  unreadable: string[]; // listed platforms NetMint cannot read historically
  offset: Offset;
  offsetSource: 'issuer' | 'default';
  chainSource: MintCheck['chainSource'];
}

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;

export function comparatorOf(series: DailyPoint[]): 'total_supply' | 'circulating_supply' {
  // total_supply only when every point in the window carries it; one null day (CMC sent 0 or nothing) → circulating for all
  return series.length > 0 && series.every((p) => p.totalSupply != null) ? 'total_supply' : 'circulating_supply';
}

export function mintCheck(input: MintInput, p = PARAMS): MintCheck {
  const { series, flows, chainAt, legs, unreadable, offset, offsetSource, chainSource } = input;
  const A = series[0], B = series[series.length - 1];
  const comparator = comparatorOf(series);
  const tot = (pt: DailyPoint) => (comparator === 'total_supply' ? (pt.totalSupply as number) : pt.supply);
  const byDate = new Map(series.map((pt) => [pt.date, pt]));
  const base: MintCheck = {
    status: 'impossible',
    comparator,
    coverageA: null,
    coverageB: null,
    outsideSupplyA: null,
    unreadableLeg: unreadable.length > 0,
    unreadableChains: unreadable,
    tolerance: null,
    offset,
    offsetSource,
    altOffsetPasses: false,
    altOffset: null,
    windowOk: false,
    stepOk: false,
    directionOk: false,
    guardOk: true,
    coverageOk: false,
    cmcDelta: null,
    chainDelta: null,
    errPct: null,
    remedy: p.remedy,
    chainSource,
    chainDates: null,
    legs,
    stepDays: [],
    reason: '',
  };
  if (!A || !B || series.length < 2) return { ...base, reason: 'fewer than 2 accepted daily points' };
  if (legs.length === 0) {
    const where = unreadable.length ? unreadable.join(', ') : 'no listed chain';
    return { ...base, reason: `no contract on BNB Chain or Ethereum (listed on ${where}); no historical supply source` };
  }
  const a = addDays(A.date, offset), b = addDays(B.date, offset);
  const chainA = chainAt(a), chainB = chainAt(b);
  const cmcA = tot(A), cmcB = tot(B);
  const cmcDelta = cmcB - cmcA;
  const out: MintCheck = { ...base, cmcDelta, chainDates: [a, b] };
  if (chainA === null || chainB === null) {
    return { ...out, reason: `chain check unavailable: no chain supply for ${chainA === null ? a : b}` };
  }
  const coverageA = chainA / cmcA;
  const coverageB = chainB / cmcB;
  const u = Math.max(cmcA - chainA, 0);
  Object.assign(out, { coverageA, coverageB, outsideSupplyA: u, chainDelta: chainB - chainA });
  const firstUnread = unreadable[0] ?? 'a chain NetMint cannot read';

  // circulating guard: the stamp must certify the series the dollars use (evaluated first; failure is NOT VERIFIABLE)
  const dCirc = B.supply - A.supply;
  const guardTol = Math.max(p.remedy * Math.abs(cmcDelta), p.floorFrac * cmcB) + u;
  out.guardOk = comparator === 'circulating_supply' || Math.abs(dCirc - cmcDelta) <= guardTol;

  if (coverageA < p.coverageMin) {
    return {
      ...out,
      reason: `${pct(1 - coverageA, 0)} of supply sits outside BNB Chain + Ethereum (${firstUnread}), which has no historical supply source`,
    };
  }
  if (coverageA > p.coverageMax) {
    return { ...out, reason: `chain and CMC disagree on the level (${pct(coverageA, 0)} of CMC ${comparator.replace('_', ' ')})` };
  }
  out.coverageOk = true;
  if (!out.guardOk) {
    return {
      ...out,
      reason: `CMC circulating and total supply diverge (circulating ${signed(dCirc)} vs total ${signed(cmcDelta)})`,
    };
  }

  // step check: material step days (largest |flow| until ≥ 80% of gross, ≤ 5), 3-day sums, not shifted by d
  const gross = flows.reduce((s, f) => s + Math.abs(f.flow), 0);
  const ranked = [...flows].sort((x, y) => Math.abs(y.flow) - Math.abs(x.flow));
  const material: string[] = [];
  let carried = 0;
  for (const f of ranked) {
    if (gross === 0 || carried >= p.stepCarry * gross || material.length >= p.maxStepDays) break;
    material.push(f.date);
    carried += Math.abs(f.flow);
  }
  const stepDays: StepDay[] = [];
  let stepUnavailable: string | null = null;
  for (const D of material) {
    const lo = clampDate(addDays(D, -2), A.date, B.date);
    const hi = clampDate(addDays(D, 1), A.date, B.date);
    const cLo = byDate.get(lo), cHi = byDate.get(hi);
    const cmc3d = cLo && cHi ? tot(cHi) - tot(cLo) : 0;
    const chLo = chainAt(lo), chHi = chainAt(hi);
    if (chLo === null || chHi === null) {
      stepUnavailable ??= chLo === null ? lo : hi;
      stepDays.push({ date: D, cmc3d, chain3d: null, ok: false });
      continue;
    }
    const chain3d = chHi - chLo;
    const tolStep = Math.max(p.remedy * Math.abs(cmc3d), p.floorFrac * cmcB);
    stepDays.push({ date: D, cmc3d, chain3d, ok: Math.abs(chain3d - cmc3d) <= tolStep });
  }
  out.stepDays = stepDays;
  if (stepUnavailable) return { ...out, reason: `chain check unavailable: no chain supply for ${stepUnavailable}` };
  out.stepOk = stepDays.every((s) => s.ok);

  const evalAt = (d: Offset) => {
    const ca = chainAt(addDays(A.date, d)), cb = chainAt(addDays(B.date, d));
    if (ca === null || cb === null) return null;
    const chainDelta = cb - ca;
    const tol = Math.max(p.remedy * Math.abs(cmcDelta), p.floorFrac * cmcB);
    const windowOk = Math.abs(chainDelta - cmcDelta) <= tol;
    const directionOk =
      cmcDelta === 0 ? windowOk : sign(chainDelta) === sign(cmcDelta) && Math.abs(chainDelta) >= p.directionRatio * Math.abs(cmcDelta);
    return { chainDelta, tol, windowOk, directionOk };
  };
  const at = evalAt(offset)!;
  Object.assign(out, {
    tolerance: at.tol,
    windowOk: at.windowOk,
    directionOk: at.directionOk,
    chainDelta: at.chainDelta,
    errPct: cmcDelta !== 0 ? (at.chainDelta - cmcDelta) / Math.abs(cmcDelta) : null,
  });
  if (at.windowOk && at.directionOk && out.stepOk) {
    return {
      ...out,
      status: 'pass',
      reason: `window endpoints and the steps carrying ≥ 80% of the flow verified within remedy (chain ${signed(at.chainDelta)} · CMC ${signed(cmcDelta)} · ${errLine(out.errPct)})`,
    };
  }
  // failure routing (1): another single offset passes → ambiguous alignment, never RECOUNT
  for (const alt of [-1, 0, 1] as Offset[]) {
    if (alt === offset) continue;
    const r = evalAt(alt);
    if (r && r.windowOk && r.directionOk && out.stepOk) {
      return {
        ...out,
        status: 'ambiguous',
        altOffsetPasses: true,
        altOffset: alt,
        reason: `endpoint alignment ambiguous: fails at d = ${offset} (issuer offset), passes at d = ${alt}`,
      };
    }
  }
  const what = !out.stepOk ? 'step check' : !at.windowOk ? 'window check' : 'direction check';
  return {
    ...out,
    status: 'fail',
    reason: `${what} failed at d = ${offset}: chain ${signed(at.chainDelta)} vs CMC ${signed(cmcDelta)} (tolerance ±${fmt(at.tol)})`,
  };
}

function clampDate(d: string, lo: string, hi: string): string {
  return d < lo ? lo : d > hi ? hi : d;
}
function signed(x: number): string {
  return `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x))}`;
}
function errLine(e: number | null): string {
  return e === null ? 'no move' : `${e >= 0 ? '+' : '−'}${Math.abs(e * 100).toFixed(1)}% · within remedy ±10%`;
}
