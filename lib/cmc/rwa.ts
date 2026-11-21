/**
 * Endpoints 1 + 2: /v5/real-world-assets/assets/list (the underlying → rwa_id) and
 * /v5/real-world-assets/quotes/latest?rwa_id= (every wrapper of one stock).
 * assets/list caps `limit` at 250 (error 4001 above it, P1a) and lists rows with no tokens; we page and filter.
 */
import { cmcErrorCode } from './client';
import { CmcError } from './errors';
import type { Recorder } from '../receipts';

export interface RwaAsset {
  rwa_id: number;
  symbol: string;
  name: string;
  asset_type?: string;
  has_tokens?: boolean;
  rwa_rank?: number;
}

export interface RwaToken {
  crypto_id: number;
  symbol: string;
  name: string;
  issuer_id?: number;
  issuer_name: string;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
}

export const RWA_PAGE = 250;
const MAX_PAGES = 4; // the ranked list puts every tokenised stock with real supply in the first ~1,000 rows

function ensureOk(call: { ok: boolean; status: any; httpStatus: number; endpoint: string; body: unknown }): void {
  if (!call.ok) {
    const msg = call.status?.error_message ?? (typeof call.body === 'string' ? call.body.slice(0, 200) : 'no CMC status object');
    throw new CmcError(call.endpoint, cmcErrorCode(call.status), call.httpStatus, String(msg));
  }
}

/** Resolve a ticker (or a numeric rwa_id) to an underlying, paging the ranked list until it is found. */
export async function resolveUnderlying(rec: Recorder, u: string): Promise<{ asset: RwaAsset | null; suggestions: string[] }> {
  const want = u.trim().toUpperCase();
  const byId = /^\d+$/.test(want) ? Number(want) : null;
  const seen: RwaAsset[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const call = await rec.cmc<any>('/v5/real-world-assets/assets/list', {
      start: String(page * RWA_PAGE + 1),
      limit: String(RWA_PAGE),
    });
    ensureOk(call);
    const rows: RwaAsset[] = (call.body?.data?.rwa_assets ?? []).filter((a: RwaAsset) => a.has_tokens !== false);
    seen.push(...rows);
    const hit = rows.find((a) => (byId !== null ? a.rwa_id === byId : a.symbol?.toUpperCase() === want));
    if (hit) return { asset: hit, suggestions: [] };
    if (!call.body?.data?.has_more) break;
  }
  return { asset: null, suggestions: nearest(want, seen) };
}

/** Five nearest tickers by a cheap edit distance (for the unknown-ticker state). */
export function nearest(want: string, assets: RwaAsset[], k = 5): string[] {
  const d = (a: string, b: string) => {
    const m = a.length,
      n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[m][n];
  };
  return [...new Set(assets.filter((a) => a.asset_type !== 'commodity').map((a) => a.symbol.toUpperCase()))]
    .map((s) => ({ s, dist: d(want, s) + (s.startsWith(want.slice(0, 1)) ? 0 : 0.5) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k)
    .map((x) => x.s);
}

/** Every wrapper of one underlying. A derivative listing (`NA (Derivatives)` / market cap 0) is flagged, never dropped. */
export async function wrappersOf(
  rec: Recorder,
  rwaId: number,
): Promise<{ asset: RwaAsset; tokens: (RwaToken & { derivative: boolean })[] }> {
  const call = await rec.cmc<any>('/v5/real-world-assets/quotes/latest', { rwa_id: String(rwaId) });
  ensureOk(call);
  const a = (call.body?.data?.rwa_assets ?? []).find((x: any) => x.rwa_id === rwaId) ?? call.body?.data?.rwa_assets?.[0];
  if (!a) throw new CmcError(call.endpoint, 0, call.httpStatus, `no rwa_assets row for rwa_id ${rwaId}`);
  const tokens = (a.tokens ?? []).map((t: RwaToken) => ({ ...t, derivative: isDerivative(t) }));
  return { asset: { rwa_id: a.rwa_id, symbol: a.symbol, name: a.name, asset_type: a.asset_type }, tokens };
}

/** Only CMC's own issuer label marks a derivative. A zero RWA-quote market cap alone does not (a2a arch r1: Robinhood
 * SPCX and Backed wMUx carry market_cap 0 on 2026-11-21); those wrappers go to trial like any other. */
export function isDerivative(t: Pick<RwaToken, 'issuer_name' | 'market_cap'>): boolean {
  return /deriv/i.test(t.issuer_name ?? '');
}
