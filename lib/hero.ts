/** The hero rule (pure; shared by the server page, the client card and the scripts):
 * largest |net| among REAL INFLOW / OUTFLOW; else the largest |net| with its actual verdict (empty-hero state). */
import type { LookupResult, WrapperResult } from './types';

export function heroOf(r: Pick<LookupResult, 'wrappers'>): { wrapper: WrapperResult | null; verified: boolean } {
  const scored = r.wrappers.filter((w) => w.metrics && w.verdict);
  const verified = scored.filter((w) => w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW');
  const pick = (xs: WrapperResult[]) => [...xs].sort((a, b) => Math.abs(b.metrics!.net) - Math.abs(a.metrics!.net))[0] ?? null;
  return verified.length ? { wrapper: pick(verified), verified: true } : { wrapper: pick(scored), verified: false };
}
