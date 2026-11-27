/**
 * Stored verbatim CMC bodies: the "live-stored" click path.
 *
 * A key's plan can shrink (hackathon event access reverts to CMC's free Basic tier when submissions close), its credits
 * can run out, or it can be disabled. If `quotes/historical` (or any other call) answers with a classified ENTITLEMENT
 * error (lib/cmc/errors.ts: plan / credit refusal, never a 5xx, timeout or rate limit), the Recorder may answer that one
 * call from a committed body instead: every capture writes
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
  /** requested ids this body does not hold: a partial answer, only ever given on the refusal path (`partial: true`) */
  missingIds?: string[];
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

const idSet = (p: Record<string, string>) =>
  new Set(
    String(p.id ?? '')
      .split(',')
      .filter(Boolean),
  );
const covers = (have: Set<string>, want: Set<string>) => [...want].every((x) => have.has(x));
const lacking = (s: StoredBody, want: Set<string>) => [...want].filter((x) => !idSet(s.params).has(x));
/** The bodies that hold the most of the wanted ids (at least one of them); [] when none holds any. */
function widest(bodies: StoredBody[], want: Set<string>): StoredBody[] {
  const held = (s: StoredBody) => want.size - lacking(s, want).length;
  const best = Math.max(0, ...bodies.map(held));
  return best ? bodies.filter((s) => held(s) === best) : [];
}
const sameExcept = (a: Record<string, string>, b: Record<string, string>, skip: string[]) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !skip.includes(k)));
  return [...keys].every((k) => a[k] === b[k]);
};

/**
 * The best stored body for a request, or null.
 * - id-keyed endpoints: the stored id set must contain every requested id (other params equal).
 * - quotes/historical: prefer a body whose [time_start, time_end] contains the request; else the body with the latest
 *   time_end (the caller re-anchors a rolling window on it, or refuses a pinned window it does not contain).
 * - `partial` (the refusal path of /api/lookup only): the id list of a click comes from CMC's LIVE wrapper list, so one
 *   wrapper listed after the capture would leave no body that holds every id and cost every stored wrapper its verdict.
 *   With `partial`, the body holding the most of the requested ids answers instead and names the ids it lacks
 *   (`missingIds`); the caller prints those wrappers without a verdict. Never used to replay or to build evidence.
 */
export function findStored(
  index: StoredBody[],
  endpoint: string,
  params: Record<string, string>,
  opts: { partial?: boolean } = {},
): StoredBody | null {
  const mine = index.filter((s) => s.endpoint === endpoint);
  const named = (s: StoredBody | null | undefined, want: Set<string>): StoredBody | null => {
    if (!s) return null;
    const missing = lacking(s, want);
    return missing.length ? { ...s, missingIds: missing } : s;
  };
  if (endpoint === HIST) {
    const want = idSet(params);
    const same = mine.filter((s) => sameExcept(s.params, params, ['id', 'time_start', 'time_end']));
    let ok = same.filter((s) => covers(idSet(s.params), want));
    if (!ok.length && opts.partial) ok = widest(same, want);
    const full = ok.find((s) => s.params.time_start <= params.time_start && s.params.time_end >= params.time_end);
    if (full) return named(full, want);
    // latest end first; at an equal end the widest body (earliest start), so a 30 d click never gets the 7 d file
    return named(
      [...ok].sort(
        (a, b) => b.params.time_end.localeCompare(a.params.time_end) || a.params.time_start.localeCompare(b.params.time_start),
      )[0],
      want,
    );
  }
  if ('id' in params) {
    const want = idSet(params);
    const same = mine.filter((s) => sameExcept(s.params, params, ['id']));
    const hit = same.find((s) => covers(idSet(s.params), want));
    if (hit || !opts.partial) return hit ?? null;
    return named(widest(same, want)[0], want); // newest first among the widest
  }
  if (endpoint === '/v5/real-world-assets/assets/list') {
    // stored captures hold one 250-row page; serve it for page 1 only, never as a fake later page
    return (params.start ?? '1') === '1' ? (mine.find((s) => (s.params.start ?? '1') === '1') ?? null) : null;
  }
  return mine.find((s) => sameExcept(s.params, params, [])) ?? null;
}

let memo: StoredBody[] | null = null;
/** Lazy, per-instance index over the committed evidence (read only when a call is refused). */
export const committedStore: StoredLookup = (endpoint, params) => {
  memo ??= loadStoredIndex();
  return findStored(memo, endpoint, params);
};

/**
 * The store behind a refused call on /api/lookup: the committed evidence, with partial id coverage allowed (see findStored).
 * The recorded hero, `verify:flows` and every other replay keep the strict `committedStore`.
 */
export const committedStorePartial: StoredLookup = (endpoint, params) => {
  memo ??= loadStoredIndex();
  return findStored(memo, endpoint, params, { partial: true });
};

/** test hook */
export function storeFrom(bodies: StoredBody[], opts: { partial?: boolean } = {}): StoredLookup {
  return (endpoint, params) => findStored(bodies, endpoint, params, opts);
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
      return {
        endpoint,
        params,
        method: 'GET',
        httpStatus: 404,
        ok: false,
        startedUtc: new Date(0).toISOString(),
        elapsedMs: 0,
        status: { error_code: -1, error_message: `no committed CMC body answers ${endpoint}` },
        body: null as T,
      };
    }
    const status = (s.body as { status?: CmcCall['status'] } | null)?.status ?? null;
    return {
      endpoint,
      params: s.params,
      method: 'GET',
      httpStatus: 200,
      ok: true,
      startedUtc: s.capturedUtc,
      elapsedMs: 0,
      status,
      body: s.body as T,
      stored: { file: s.file, capturedUtc: s.capturedUtc },
    };
  };
}
