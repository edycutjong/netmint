/**
 * Sanity guard (complexity §1, "artefact data"). Refuses rows that cannot be real and lists every refusal;
 * nothing is dropped silently: accepted.length + refused rows that came from raw rows = raw.length.
 * A one-way step is NOT a guard case (it goes to the chain check); only a step that reverts within a day is.
 */
import { PARAMS } from './params';
import type { DailyPoint, RawDailyRow, RefusedRow } from '../types';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface GuardResult {
  accepted: DailyPoint[];
  refused: RefusedRow[]; // includes `gap` entries (raw: null) for missing days
}

export function sanityGuard(raw: RawDailyRow[], p = PARAMS): GuardResult {
  const refused: RefusedRow[] = [];
  const firstPass: { pt: DailyPoint; raw: RawDailyRow }[] = [];
  const seen = new Set<string>();
  const sorted = [...raw].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (const r of sorted) {
    const date = String(r.timestamp ?? '').slice(0, 10);
    const price = num(r.price);
    const supply = num(r.circulating_supply);
    const tot = num(r.total_supply);
    if (seen.has(date)) {
      refused.push({ date, reason: 'duplicate', detail: `second row for ${date}`, raw: r });
      continue;
    }
    seen.add(date);
    if (price === null) refused.push({ date, reason: 'price_missing', detail: 'price missing', raw: r });
    else if (price <= 0) refused.push({ date, reason: 'price_nonpositive', detail: `price ${price}`, raw: r });
    else if (supply === null || supply <= 0)
      refused.push({ date, reason: 'supply_missing', detail: `circulating supply ${supply ?? 'missing'}`, raw: r });
    else if (price > p.maxPrice) refused.push({ date, reason: 'magnitude', detail: `price ${price.toExponential(2)}`, raw: r });
    else if (supply > p.maxSupply || (tot !== null && tot > p.maxSupply))
      refused.push({ date, reason: 'magnitude', detail: `supply ${Math.max(supply, tot ?? 0).toExponential(2)}`, raw: r });
    else
      firstPass.push({
        pt: {
          date,
          supply,
          totalSupply: tot !== null && tot > 0 ? tot : null,
          price,
          volume24h: num(r.volume_24h) ?? 0,
          marketCap: num(r.market_cap) ?? supply * price,
        },
        raw: r,
      });
  }
  // spike-and-return: S jumps by ≥ spikeMinFrac of itself, then the next point reverts ≥ spikeRevertFrac of the jump
  const accepted: DailyPoint[] = [];
  for (let i = 0; i < firstPass.length; i++) {
    const prev = accepted[accepted.length - 1];
    const cur = firstPass[i].pt;
    const next = firstPass[i + 1]?.pt;
    if (prev && next && dayDiff(prev.date, cur.date) === 1 && dayDiff(cur.date, next.date) === 1) {
      const up = cur.supply - prev.supply;
      const back = next.supply - cur.supply;
      if (
        Math.abs(up) >= p.spikeMinFrac * prev.supply &&
        Math.sign(back) === -Math.sign(up) &&
        Math.abs(back) >= p.spikeRevertFrac * Math.abs(up)
      ) {
        refused.push({
          date: cur.date,
          reason: 'spike_revert',
          detail: `supply ${fmtPct(up / prev.supply)} then ${fmtPct(back / cur.supply)} next day`,
          raw: firstPass[i].raw,
        });
        continue;
      }
    }
    accepted.push(cur);
  }
  // gaps: a missing day between accepted neighbours that no refused row explains
  const refusedDates = new Set(refused.map((r) => r.date));
  for (let i = 1; i < accepted.length; i++) {
    const n = dayDiff(accepted[i - 1].date, accepted[i].date);
    for (let k = 1; k < n; k++) {
      const d = shift(accepted[i - 1].date, k);
      if (!refusedDates.has(d)) refused.push({ date: d, reason: 'gap', detail: 'no CMC row for this day', raw: null });
    }
  }
  refused.sort((a, b) => a.date.localeCompare(b.date));
  return { accepted, refused };
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
function shift(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
