/** The hero rule (pure; shared by the server page, the client card and the scripts):
 * largest |net| among REAL INFLOW / OUTFLOW; else the largest |net| with its actual verdict (empty-hero state). */
import type { LookupResult, WrapperResult } from './types';

/**
 * The home page hero is pinned to one committed capture and replayed from its verbatim CMC bodies (no CMC call on page
 * load), so the figure matches the README and the video. "Run it live" re-runs the same window against CMC on click.
 * `npm run snapshot` writes a new capture; move this window to it, and freeze it at the video take.
 */
export const HERO_WINDOW = { u: 'NVDA', from: '2026-10-22', to: '2026-11-21' } as const;

export function heroOf(r: Pick<LookupResult, 'wrappers'>): { wrapper: WrapperResult | null; verified: boolean } {
  const scored = r.wrappers.filter((w) => w.metrics && w.verdict);
  const verified = scored.filter((w) => w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW');
  const pick = (xs: WrapperResult[]) => [...xs].sort((a, b) => Math.abs(b.metrics!.net) - Math.abs(a.metrics!.net))[0] ?? null;
  return verified.length ? { wrapper: pick(verified), verified: true } : { wrapper: pick(scored), verified: false };
}
