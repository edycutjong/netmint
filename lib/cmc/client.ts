/**
 * Minimal CoinMarketCap Pro API client. Server-side only: the key is read from
 * CMC_API_KEY and is sent as a header, never in a URL, a log line or a receipt.
 */
export const CMC_BASE = 'https://pro-api.coinmarketcap.com';

export interface CmcStatus {
  timestamp?: string;
  error_code?: number | string;
  error_message?: string | null;
  elapsed?: number;
  credit_count?: number;
  notice?: string | null;
}

export interface CmcCall<T = unknown> {
  endpoint: string; // path only, e.g. /v1/key/info
  params: Record<string, string>;
  method: 'GET' | 'POST';
  httpStatus: number;
  ok: boolean; // HTTP 2xx and status.error_code == 0
  startedUtc: string;
  elapsedMs: number;
  status: CmcStatus | null;
  body: T; // verbatim parsed JSON body (or raw text if not JSON)
}

export function cmcErrorCode(status: CmcStatus | null): number {
  const c = status?.error_code;
  if (c === undefined || c === null) return 0;
  const n = typeof c === 'number' ? c : Number(c);
  return Number.isFinite(n) ? n : -1;
}

export async function cmcFetch<T = unknown>(
  endpoint: string,
  params: Record<string, string> = {},
  opts: { method?: 'GET' | 'POST'; jsonBody?: unknown; apiKey?: string; timeoutMs?: number } = {},
): Promise<CmcCall<T>> {
  const apiKey = opts.apiKey ?? process.env.CMC_API_KEY;
  if (!apiKey) throw new Error('CMC_API_KEY is not set');
  const method = opts.method ?? 'GET';
  const qs = new URLSearchParams(params).toString();
  const url = `${CMC_BASE}${endpoint}${qs ? `?${qs}` : ''}`;
  const startedUtc = new Date().toISOString();
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: {
      'X-CMC_PRO_API_KEY': apiKey,
      Accept: 'application/json',
      ...(opts.jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    cache: 'no-store',
  });
  const text = await res.text();
  const elapsedMs = Math.round(performance.now() - t0);
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  const status =
    body && typeof body === 'object' && 'status' in body ? ((body as { status: CmcStatus }).status ?? null) : null;
  const ok = res.ok && cmcErrorCode(status) === 0;
  return { endpoint, params, method, httpStatus: res.status, ok, startedUtc, elapsedMs, status, body: body as T };
}
