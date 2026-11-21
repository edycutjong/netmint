/**
 * Endpoint 3: /v2/cryptocurrency/quotes/historical?id=a,b,c&interval=daily — the daily circulating_supply,
 * total_supply, price, volume_24h and market_cap series. One multi-id call (measured 2026-11-21: 2 ids × 32 days =
 * 1 credit, body keyed by id). USD only: `convert=` alters history values (docs/API-NOTES.md), so it is never sent.
 * `time_start` is exclusive at day granularity (time_start=10-20 → first point 10-21), so we ask from the day before.
 */
import { cmcErrorCode } from './client';
import { CmcError } from './errors';
import type { Recorder } from '../receipts';
import type { RawDailyRow } from '../types';

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function parseHistoryBody(body: any): Map<number, RawDailyRow[]> {
  const out = new Map<number, RawDailyRow[]>();
  const data = body?.data;
  if (!data) return out;
  // single id → data = { id, quotes }; multi id → data = { "<id>": { id, quotes } }
  const entries: any[] = Array.isArray(data?.quotes) ? [data] : Object.values(data);
  for (const e of entries) {
    const id = Number(e?.id);
    if (!Number.isFinite(id)) continue;
    out.set(
      id,
      (e.quotes ?? []).map((q: any) => {
        const u = q?.quote?.USD ?? {};
        return {
          timestamp: q?.timestamp ?? u.timestamp,
          price: u.price,
          circulating_supply: u.circulating_supply,
          total_supply: u.total_supply,
          volume_24h: u.volume_24h,
          market_cap: u.market_cap,
        } satisfies RawDailyRow;
      }),
    );
  }
  return out;
}

/** Daily rows for every id over [from, to] (inclusive UTC days). */
export async function dailyHistory(
  rec: Recorder,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<number, RawDailyRow[]>> {
  if (ids.length === 0) return new Map();
  const call = await rec.cmc<any>('/v2/cryptocurrency/quotes/historical', {
    id: ids.join(','),
    interval: 'daily',
    time_start: addDays(from, -1),
    time_end: to,
  });
  if (!call.ok) {
    throw new CmcError(call.endpoint, cmcErrorCode(call.status), call.httpStatus, String(call.status?.error_message ?? 'no CMC status object'));
  }
  const m = parseHistoryBody(call.body);
  // keep only rows inside [from, to]
  for (const [id, rows] of m) m.set(id, rows.filter((r) => r.timestamp && r.timestamp.slice(0, 10) >= from && r.timestamp.slice(0, 10) <= to));
  return m;
}
