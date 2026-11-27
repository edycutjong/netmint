/** Validation for /api/lookup query params (kept out of the route file: Next.js allows only handler exports there). */
import { isUtcDay } from './cmc/history';
import type { LookupWindow } from './types';

export function parseLookupParams(
  sp: URLSearchParams,
): { ok: true; u: string; window: LookupWindow; from?: string; to?: string; key: string } | { ok: false; error: string } {
  const u = (sp.get('u') ?? '').trim();
  if (!u || u.length > 20 || !/^[A-Za-z0-9.\-]+$/.test(u))
    return { ok: false, error: 'u must be a ticker or rwa_id (letters, digits, . or -)' };
  const w = sp.get('window');
  const window = (w === null ? 30 : Number(w)) as LookupWindow;
  if (![7, 30, 90].includes(window)) return { ok: false, error: 'window must be 7, 30 or 90' };
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  if ((from && !to) || (!from && to)) return { ok: false, error: 'from and to go together' };
  // a day that does not exist (2026-11-31) would otherwise be printed as the window's last day, or throw after CMC was called
  if (from && to && (!isUtcDay(from) || !isUtcDay(to) || from >= to))
    return { ok: false, error: 'from/to must be real calendar days (YYYY-MM-DD) with from < to' };
  if (from && to && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 120)
    return { ok: false, error: 'a pinned window is at most 120 days' };
  const key = `${u.toUpperCase()}|${from ? `${from}..${to}` : `w${window}`}`;
  return { ok: true, u, window, from, to, key };
}
