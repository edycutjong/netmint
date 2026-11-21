/** One plain Cite line per verdict, for a research note. */
import { pct, times, usd, utcStamp, VERDICT_LABEL } from './format';
import type { LookupResult, WrapperResult } from './types';

export function citeLine(r: Pick<LookupResult, 'range' | 'fetchedUtc' | 'underlying'>, w: WrapperResult, origin = 'https://netmint.edycu.dev'): string {
  const v = w.verdict ? VERDICT_LABEL[w.verdict] : 'NO VERDICT';
  const m = w.metrics;
  const proved = w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW';
  const fig = m
    ? `${proved ? 'net creation' : 'CMC supply change × price (unproven)'} ${usd(m.net)} ($ at wrapper market price), units ${times(m.unitsX)}, price ${pct(m.pricePct)}`
    : 'no figure';
  const link = `${origin}/u/${encodeURIComponent(r.underlying.ticker)}?from=${r.range.from}&to=${r.range.to}`;
  return `NetMint: ${w.symbol} (${w.issuer}) ${v}: ${fig}; window ${r.range.from} to ${r.range.to} UTC; captured ${utcStamp(r.fetchedUtc)}; ${link}`;
}
