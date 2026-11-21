/**
 * Stored verbatim CMC bodies: the "live-stored" click path.
 *
 * The event key reverts to CMC's free Basic plan when submissions close. If `quotes/historical` (or any other call)
 * then answers with a classified ENTITLEMENT error (lib/cmc/errors.ts: plan / credit refusal, never a 5xx, timeout or
 * rate limit), the Recorder may answer that one call from a committed body instead: every capture writes
 * `evidence/<date>/**\/NN-<endpoint>.json` as `{ receipt, body }`, exactly what CMC returned on that day.
 * The verdict is still re-run on the click, the chain is still read live, and the response says which bodies were
 * stored and when they were captured. Nothing here ever fabricates a body.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CmcCall } from './cmc/client';

export interface StoredBody {
  endpoint: string;
  params: Record<string, string>;
  capturedUtc: string;
  /** repo-relative path of the committed file */
  file: string;
  body: unknown;
}

export type StoredLookup = (endpoint: string, params: Record<string, string>) => StoredBody | null;

const HIST = '/v2/cryptocurrency/quotes/historical';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Every successful CMC body committed under evidence/, newest capture first. */
export function loadStoredIndex(root = process.cwd()): StoredBody[] {
  const base = path.join(root, 'evidence');
  if (!existsSync(base)) return [];
  const out: StoredBody[] = [];
  for (const f of walk(base)) {
    let j: any;
    try {
      j = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    const r = j?.receipt;
    if (!r || r.kind !== 'cmc' || r.httpStatus !== 200 || Number(r.errorCode ?? 0) !== 0) continue;
    if (!j.body || typeof j.body !== 'object' || (j.body as { truncated?: boolean }).truncated) continue;
    out.push({ endpoint: r.endpoint, params: r.params ?? {}, capturedUtc: r.startedUtc, file: path.relative(root, f), body: j.body });
  }
  return out.sort((a, b) => (a.capturedUtc < b.capturedUtc ? 1 : a.capturedUtc > b.capturedUtc ? -1 : 0));
}

const idSet = (p: Record<string, string>) => new Set(String(p.id ?? '').split(',').filter(Boolean));
const covers = (have: Set<string>, want: Set<string>) => [...want].every((x) => have.has(x));
const sameExcept = (a: Record<string, string>, b: Record<string, string>, skip: string[]) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !skip.includes(k)));
  return [...keys].every((k) => a[k] === b[k]);
};

/**
 * The best stored body for a request, or null.
 * - id-keyed endpoints: the stored id set must contain every requested id (other params equal).
 * - quotes/historical: prefer a body whose [time_start, time_end] contains the request; else the body with the latest
 *   time_end (the caller re-anchors a rolling window on it, or refuses a pinned window it does not contain).
 */
export function findStored(index: StoredBody[], endpoint: string, params: Record<string, string>): StoredBody | null {
  const mine = index.filter((s) => s.endpoint === endpoint);
  if (endpoint === HIST) {
    const want = idSet(params);
    const ok = mine.filter((s) => covers(idSet(s.params), want) && sameExcept(s.params, params, ['id', 'time_start', 'time_end']));
    const full = ok.find((s) => s.params.time_start <= params.time_start && s.params.time_end >= params.time_end);
    if (full) return full;
    return [...ok].sort((a, b) => (a.params.time_end < b.params.time_end ? 1 : -1))[0] ?? null;
  }
  if ('id' in params) {
    const want = idSet(params);
    return mine.find((s) => covers(idSet(s.params), want) && sameExcept(s.params, params, ['id'])) ?? null;
  }
  if (endpoint === '/v5/real-world-assets/assets/list') {
    // stored captures hold one 250-row page; serve it for page 1 only, never as a fake later page
    return (params.start ?? '1') === '1' ? (mine[0] ?? null) : null;
  }
  return mine.find((s) => sameExcept(s.params, params, [])) ?? null;
}

let memo: StoredBody[] | null = null;
/** Lazy, per-instance index over the committed evidence (read only when a call is refused). */
export const committedStore: StoredLookup = (endpoint, params) => {
  memo ??= loadStoredIndex();
  return findStored(memo, endpoint, params);
};

/** test hook */
export function storeFrom(bodies: StoredBody[]): StoredLookup {
  return (endpoint, params) => findStored(bodies, endpoint, params);
}

/** For /api/health: how far the committed history reaches if CMC starts refusing quotes/historical. */
export function storedSummary(): { bodies: number; history_bodies: number; history_end: string | null; newest_capture_utc: string | null } {
  memo ??= loadStoredIndex();
  const hist = memo.filter((s) => s.endpoint === HIST);
  const end = hist.reduce<string | null>((m, s) => (m === null || s.params.time_end > m ? s.params.time_end : m), null);
  return { bodies: memo.length, history_bodies: hist.length, history_end: end, newest_capture_utc: memo[0]?.capturedUtc ?? null };
}

/**
 * A CMC transport that answers only from committed bodies (no network): the recorded hero render. A request with no
 * committed body is a non-ok call (the page then shows the error, never an invented figure).
 */
export function storedTransport(find: StoredLookup = committedStore) {
  return async function <T>(endpoint: string, params: Record<string, string> = {}): Promise<CmcCall<T>> {
    const s = find(endpoint, params);
    if (!s) {
      return { endpoint, params, method: 'GET', httpStatus: 404, ok: false, startedUtc: new Date(0).toISOString(), elapsedMs: 0, status: { error_code: -1, error_message: `no committed CMC body answers ${endpoint}` }, body: null as T };
    }
    const status = (s.body as { status?: CmcCall['status'] } | null)?.status ?? null;
    return { endpoint, params: s.params, method: 'GET', httpStatus: 200, ok: true, startedUtc: s.capturedUtc, elapsedMs: 0, status, body: s.body as T, stored: { file: s.file, capturedUtc: s.capturedUtc } };
  };
}
