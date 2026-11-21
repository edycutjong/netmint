/**
 * Endpoint 6: /v2/cryptocurrency/quotes/latest?id= → today's point (live price, supply, 24h volume).
 * Shown separately; never part of ΔS, the window, the dollar net or the mint check.
 */
import type { Recorder } from '../receipts';

export interface TodayPoint {
  price: number | null;
  supply: number | null;
  volume24h: number | null;
  marketCap: number | null;
  capturedUtc: string;
}

export async function latestQuotes(rec: Recorder, ids: number[]): Promise<Map<number, TodayPoint>> {
  const out = new Map<number, TodayPoint>();
  if (ids.length === 0) return out;
  const call = await rec.cmc<any>('/v2/cryptocurrency/quotes/latest', { id: ids.join(',') });
  if (!call.ok) return out; // display-only: a failure here never blocks a verdict
  for (const e of Object.values<any>(call.body?.data ?? {})) {
    const u = e?.quote?.USD ?? {};
    out.set(Number(e.id), {
      price: u.price ?? null,
      supply: e.circulating_supply ?? null,
      volume24h: u.volume_24h ?? null,
      marketCap: u.market_cap ?? null,
      capturedUtc: u.last_updated ?? call.startedUtc,
    });
  }
  return out;
}
