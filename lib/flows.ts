/**
 * /flows leaderboard: one row per tokenised-stock wrapper, ranked by verified net creation.
 * Built by `npm run flows` from the same lookup() the click runs (rows are views of the core computation),
 * committed under evidence/<date>/flows-<w>d.json, read by the /flows page. No nightly job: `npm run flows` + redeploy refreshes it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LookupResult, Verdict } from './types';

export type Divergence = 'price_down_money_in' | 'price_up_money_out' | null;

export interface FlowRow {
  underlying: string;
  rwaId: number;
  cryptoId: number;
  symbol: string;
  issuer: string;
  verdict: Verdict | null;
  reason: string;
  netUsd: number | null;
  unitsX: number | null;
  pricePct: number | null;
  coverage: number | null;
  marketCap: number | null;
  exitRatio: number | null;
  divergence: Divergence;
  evidence: string; // repo-relative folder with the verbatim CMC bodies of this underlying's lookup
}

export interface FlowsTable {
  generatedUtc: string;
  command: string;
  window: 7 | 30;
  range: { from: string; to: string };
  universe: { underlyings: number; wrappers: number; ranking: string };
  credits: number;
  skipped: { underlying: string; error: string }[];
  rows: FlowRow[];
}

/** Money in while the price fell, or money out while the price rose: only for chain-verified moves. */
export function divergenceOf(verdict: Verdict | null, pricePct: number | null): Divergence {
  if (pricePct === null) return null;
  if (verdict === 'REAL_INFLOW' && pricePct < 0) return 'price_down_money_in';
  if (verdict === 'OUTFLOW' && pricePct > 0) return 'price_up_money_out';
  return null;
}

export function rowsFromLookup(r: LookupResult, evidence: string): FlowRow[] {
  return r.wrappers
    .filter((w) => !w.derivative)
    .map((w) => ({
      underlying: r.underlying.ticker,
      rwaId: r.underlying.rwaId,
      cryptoId: w.cryptoId,
      symbol: w.symbol,
      issuer: w.issuer,
      verdict: w.verdict,
      reason: w.reason,
      netUsd: w.metrics?.net ?? null,
      unitsX: w.metrics?.unitsX ?? null,
      pricePct: w.metrics?.pricePct ?? null,
      coverage: w.mint?.coverageA ?? null,
      marketCap: w.marketCap,
      exitRatio: w.exitRatio,
      divergence: divergenceOf(w.verdict, w.metrics?.pricePct ?? null),
      evidence,
    }));
}

const RANK: Record<string, number> = { REAL_INFLOW: 0, OUTFLOW: 0, RECOUNT: 1, NOT_VERIFIABLE: 2, FLAT: 3 };
/** Verified moves first by |net|, then RECOUNT, NOT VERIFIABLE, FLAT, no verdict. */
export function sortFlows(rows: FlowRow[]): FlowRow[] {
  return [...rows].sort((a, b) => {
    const ra = a.verdict ? RANK[a.verdict] : 4, rb = b.verdict ? RANK[b.verdict] : 4;
    if (ra !== rb) return ra - rb;
    const d = Math.abs(b.netUsd ?? 0) - Math.abs(a.netUsd ?? 0);
    return d !== 0 ? d : a.symbol.localeCompare(b.symbol);
  });
}

/** Newest committed evidence/<date>/flows-<w>d.json (dates sort lexically). */
export function loadFlows(window: 7 | 30, root = process.cwd()): FlowsTable | null {
  const base = path.join(root, 'evidence');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = path.join(base, d, `flows-${window}d.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as FlowsTable;
  }
  return null;
}
