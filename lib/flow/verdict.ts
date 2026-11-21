/**
 * Verdict precedence (complexity §4.3). Fixed code; no model decides a verdict.
 * Invariants (tested): REAL_INFLOW / OUTFLOW ⇒ mint.status = 'pass' AND guard passed AND sign(net) = sign(ΔcmcCirc);
 * RECOUNT ⇒ no unreadable leg AND u < 0.25 × |ΔCMC| AND no single other offset passes; FLAT ⇒ coverage(A) in bounds.
 */
import { PARAMS } from './params';
import type { FlowMetrics, MintCheck, Verdict } from '../types';

export interface VerdictOut {
  verdict: Verdict | null;
  reason: string;
}

export const SUBLINE: Record<Verdict, string> = {
  REAL_INFLOW: 'issuer-level net creation, not buyer data',
  OUTFLOW: 'issuer-level net redemption',
  RECOUNT: 'CMC supply moved; the chain did not',
  NOT_VERIFIABLE: 'not put to a full trial',
  FLAT: 'below threshold, not put to trial',
};

export function flatThreshold(m: FlowMetrics, p = PARAMS): number {
  return Math.max(p.flatUsd, p.flatCapFrac * m.marketCapA);
}

export function decideVerdict(metrics: FlowMetrics | null, mint: MintCheck | null, p = PARAMS): VerdictOut {
  // 1. error or < 2 accepted points → no verdict
  if (!metrics || !mint) return { verdict: null, reason: 'fewer than 2 accepted daily points: no verdict' };
  // 2. mint check impossible or the circulating guard failed → NOT VERIFIABLE (before FLAT)
  if ((mint.status === 'impossible' && !mint.coverageOk) || !mint.guardOk) return { verdict: 'NOT_VERIFIABLE', reason: mint.reason };
  // 3. immaterial → FLAT (decided on CMC's own net, which already sums every chain; certifies nothing)
  if (Math.abs(metrics.net) < flatThreshold(metrics, p)) {
    const failed = mint.status === 'fail' || mint.status === 'ambiguous' ? `; the chain check did not pass: ${mint.reason}` : '';
    return {
      verdict: 'FLAT',
      reason: `below threshold, not put to trial (|net| < $${Math.round(flatThreshold(metrics, p)).toLocaleString('en-US')})${failed}`,
    };
  }
  // 2b. coverage held but a step day had no chain data: material moves cannot be tried → NOT VERIFIABLE (after FLAT)
  if (mint.status === 'impossible') return { verdict: 'NOT_VERIFIABLE', reason: mint.reason };
  // 4. mint check failed → routing
  if (mint.status === 'ambiguous') return { verdict: 'NOT_VERIFIABLE', reason: mint.reason };
  if (mint.status === 'fail') {
    const u = mint.outsideSupplyA ?? 0;
    const move = Math.abs(mint.cmcDelta ?? 0);
    if (mint.unreadableLeg || u >= p.outsideRatio * move) {
      const where = mint.unreadableChains[0] ?? 'a chain outside BNB Chain + Ethereum';
      const share =
        mint.coverageA !== null ? ` (${((1 - Math.min(mint.coverageA, 1)) * 100).toFixed(1)}% of supply outside the summed chains)` : '';
      return { verdict: 'NOT_VERIFIABLE', reason: `the move may sit on ${where}${share}; ${mint.reason}` };
    }
    return { verdict: 'RECOUNT', reason: `CMC's step and the summed chains' step disagree beyond tolerance: ${mint.reason}` };
  }
  // 4b. dollar net and supply move disagree
  if (Math.sign(metrics.net) !== Math.sign(metrics.supplyDelta)) {
    return {
      verdict: 'NOT_VERIFIABLE',
      reason: 'dollar net and supply move disagree (units created cheap and redeemed dear, or the reverse)',
    };
  }
  // 5. directional verdicts
  return metrics.net > 0 ? { verdict: 'REAL_INFLOW', reason: mint.reason } : { verdict: 'OUTFLOW', reason: mint.reason };
}
