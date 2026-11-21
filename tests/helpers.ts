/** Test helpers: synthetic series builders + a recorded-response CMC transport (no network). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CmcCall } from '@/lib/cmc/client';
import type { DailyPoint, RawDailyRow } from '@/lib/types';
import { addDays } from '@/lib/cmc/history';
import { netCreation } from '@/lib/flow/netCreation';
import { mintCheck, type MintInput } from '@/lib/flow/mintCheck';
import type { Offset } from '@/lib/flow/params';

export const fixture = (name: string): any => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

/** Series from supply + price arrays starting at `start`. totalSupply = supply unless given. */
export function series(supply: number[], price: number[] | number, start = '2026-11-01', total?: (number | null)[]): DailyPoint[] {
  return supply.map((s, i) => {
    const p = Array.isArray(price) ? price[i] : price;
    return { date: addDays(start, i), supply: s, totalSupply: total ? total[i] : s, price: p, volume24h: 0, marketCap: s * p };
  });
}

export function raw(rows: Partial<RawDailyRow & { date: string }>[]): RawDailyRow[] {
  return rows.map((r) => ({
    timestamp: `${r.date}T00:00:00.000Z`,
    price: r.price,
    circulating_supply: r.circulating_supply,
    total_supply: r.total_supply ?? r.circulating_supply,
    volume_24h: 1,
    market_cap: 1,
  }));
}

/** chainAt from a date → value map (dates outside → null). */
export const chainFrom = (m: Record<string, number>) => (d: string) => (d in m ? m[d] : null);

/** chain that mirrors CMC totals shifted by `lag` days and scaled by `k`, over [start−3, end+3]. */
export function mirrorChain(s: DailyPoint[], k = 1, lag = 0): (d: string) => number | null {
  const m: Record<string, number> = {};
  const first = s[0].date;
  for (let i = -3; i < s.length + 3; i++) {
    const src = s[Math.min(Math.max(i - lag, 0), s.length - 1)];
    m[addDays(first, i)] = (src.totalSupply ?? src.supply) * k;
  }
  return chainFrom(m);
}

export function check(s: DailyPoint[], chainAt: (d: string) => number | null, o: Partial<MintInput> = {}) {
  const metrics = netCreation(s)!;
  const mint = mintCheck({
    series: s,
    flows: metrics.flows,
    chainAt,
    legs: [{ chain: 'bsc', address: '0xabc', decimals: 18, supplyA: null, supplyB: null, blocks: [null, null], source: 'baseline' }],
    unreadable: [],
    offset: 0 as Offset,
    offsetSource: 'issuer',
    chainSource: 'baseline',
    ...o,
  });
  return { metrics, mint };
}

/** A CMC transport that answers from recorded bodies by endpoint (and fails loudly on anything else). */
export function recordedTransport(over: Record<string, { body: any; httpStatus?: number }> = {}) {
  const map: Record<string, { body: any; httpStatus?: number }> = {
    '/v5/real-world-assets/assets/list': { body: fixture('recorded/rwa-assets-list-p1.json').body },
    '/v5/real-world-assets/quotes/latest': { body: fixture('recorded/rwa-quotes-nvda.json').body },
    '/v2/cryptocurrency/quotes/latest': { body: fixture('recorded/quotes-latest-nvda.json').body },
    '/v2/cryptocurrency/info': { body: fixture('recorded/info-nvda-wrappers.json').body },
    '/v2/cryptocurrency/quotes/historical': { body: fixture('recorded/hist-nvda-wrappers-30d.json').body },
    ...over,
  };
  return async function <T>(endpoint: string, params: Record<string, string> = {}): Promise<CmcCall<T>> {
    const hit = map[endpoint];
    if (!hit) throw new Error(`no recorded body for ${endpoint}`);
    const status = hit.body?.status ?? null;
    const code = Number(status?.error_code ?? 0);
    const httpStatus = hit.httpStatus ?? 200;
    return { endpoint, params, method: 'GET', httpStatus, ok: httpStatus < 300 && code === 0 && status !== null, startedUtc: '2026-11-21T01:40:00.000Z', elapsedMs: 1, status, body: hit.body as T };
  };
}

export const NOW = Date.parse('2026-11-21T01:40:00Z');
