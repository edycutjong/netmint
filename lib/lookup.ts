/**
 * The one core flow: underlying → every wrapper → daily supply history → sanity guard → net creation →
 * mint check against the chain → verdict, with a receipt for every external call.
 * Used by /api/lookup, `npm run demo`, `npm run snapshot` and the hero card.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Recorder, redact } from './receipts';
import { committedStore } from './stored';
import { resolveUnderlying, wrappersOf } from './cmc/rwa';
import { addDays, dailyHistory, historyRows, historySpan } from './cmc/history';
import { contractMaps, type ContractMap } from './cmc/info';
import { latestQuotes } from './cmc/quotes';
import { CmcError } from './cmc/errors';
import { sanityGuard } from './flow/sanity';
import { netCreation } from './flow/netCreation';
import { mintCheck } from './flow/mintCheck';
import { decideVerdict } from './flow/verdict';
import { PARAMS, type Offset } from './flow/params';
import { chainLegs, legSupplies, sourceOf, summed } from './chain/supply';
import type { LookupResult, LookupWindow, MintReceipt, ProofStep, RawDailyRow, WrapperResult } from './types';

export class LookupFailure extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface OffsetsFile {
  issuers: Record<string, { d: Offset }>;
}
let offsetsCache: OffsetsFile | null = null;
export function issuerOffset(issuer: string): { d: Offset; source: 'issuer' | 'default' } {
  if (!offsetsCache) {
    const p = path.join(process.cwd(), 'data', 'offsets.json');
    offsetsCache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as OffsetsFile) : { issuers: {} };
  }
  const hit = offsetsCache.issuers[issuer];
  return hit ? { d: hit.d, source: 'issuer' } : { d: 0, source: 'default' };
}

let mintsCache: MintReceipt[] | null = null;
export function cachedMints(): MintReceipt[] {
  if (!mintsCache) {
    const p = path.join(process.cwd(), 'data', 'mints.json');
    mintsCache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as MintReceipt[]) : [];
  }
  return mintsCache;
}

export const todayUtc = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LookupOpts {
  window?: LookupWindow;
  from?: string;
  to?: string;
  rec?: Recorder;
  nowMs?: number;
  allowLiveChain?: boolean;
  /** answer CMC entitlement refusals from the committed evidence (the judged URL only; never in capture scripts) */
  storedFallback?: boolean;
}

const HIST = '/v2/cryptocurrency/quotes/historical';

export async function lookup(u: string, opts: LookupOpts = {}): Promise<LookupResult> {
  const t0 = performance.now();
  const rec = opts.rec ?? new Recorder(undefined, undefined, opts.storedFallback ? committedStore : null);
  const fetchedUtc = new Date(opts.nowMs ?? Date.now()).toISOString();
  const pinned = Boolean(opts.from && opts.to);
  if (pinned && (!DATE_RE.test(opts.from!) || !DATE_RE.test(opts.to!) || opts.from! >= opts.to!)) {
    throw new LookupFailure(400, 'from/to must be YYYY-MM-DD with from < to');
  }
  const window: LookupWindow | null = pinned ? null : (opts.window ?? 30);
  let to = pinned ? opts.to! : todayUtc(opts.nowMs);
  let from = pinned ? opts.from! : addDays(to, -(window as number));

  try {
    const { asset, suggestions } = await resolveUnderlying(rec, u);
    if (!asset) throw new LookupFailure(404, `No tokenised wrappers on CMC for '${u}'`, { suggestions, receipts: rec.receipts, credits: rec.credits });
    const { asset: full, tokens } = await wrappersOf(rec, asset.rwa_id);
    const live = tokens.filter((t) => !t.derivative);
    const ids = live.map((t) => t.crypto_id);

    const [hist0, maps, today] = await Promise.all([
      dailyHistory(rec, ids, from, to),
      contractMaps(rec, ids),
      latestQuotes(rec, ids),
    ]);
    let hist = hist0;

    // live-stored: CMC refused quotes/historical (plan), a committed body answered. A rolling window ends on the
    // stored history's last day (never padded to today); a pinned window must sit inside the stored body.
    const histFb = rec.fallbacks.find((f) => f.endpoint === HIST);
    const span = histFb ? historySpan(histFb.body, ids) : null;
    if (histFb && span) {
      // a rolling window ends on the stored history's last day for these ids (never padded to today) …
      if (!pinned && span.last && span.last < to) {
        to = span.last;
        from = addDays(to, -(window as number));
      }
      // … and every window, rolling or pinned, must sit inside the stored days: never priced on fewer days than it states
      if (!span.last || span.last < to || span.first > from) {
        throw new LookupFailure(503, `CMC refused ${HIST} (error_code ${histFb.liveError.code}: ${histFb.liveError.message}) and the stored daily bodies (${span.first || '—'} → ${span.last || '—'}) do not contain ${from} → ${to}${pinned ? '' : '; the 7 d and 30 d windows are stored'}`, {
          cmcError: { ...histFb.liveError, endpoint: HIST, class: 'entitlement' },
          receipts: rec.receipts,
          credits: rec.credits,
        });
      }
      hist = historyRows(histFb.body, from, to);
    }
    // every CMC endpoint that answered live on this click; if a live-stored answer has none, /v1/key/info (0 credits)
    const liveOk = () => [...new Set(rec.receipts.filter((r) => r.kind === 'cmc' && !r.stored && r.errorCode === 0 && r.httpStatus === 200).map((r) => r.endpoint))];
    if (rec.fallbacks.length && liveOk().length === 0) await rec.cmc('/v1/key/info', {});
    const liveCmcCalls = liveOk();

    // chain supply for every readable leg over [from−2, to+1] (endpoint ±1 and 3-day step sums)
    const allLegs = [...maps.values()].flatMap((m) => m.legs);
    const uniq = [...new Map(allLegs.map((l) => [`${l.chain}:${l.address}`, l])).values()];
    const dates: string[] = [];
    for (let d = addDays(from, -2); d <= addDays(to, 1); d = addDays(d, 1)) dates.push(d);
    const chain = await legSupplies(rec, uniq, dates, { allowLive: opts.allowLiveChain ?? true, nowMs: opts.nowMs });

    const wrappers: WrapperResult[] = tokens.map((t) => {
      const map: ContractMap = maps.get(t.crypto_id) ?? { legs: [], unreadable: [] };
      const chains = [...map.legs.map((l) => (l.chain === 'bsc' ? 'BNB Chain' : 'Ethereum')), ...map.unreadable];
      const tq = today.get(t.crypto_id);
      const base: WrapperResult = {
        cryptoId: t.crypto_id,
        symbol: t.symbol,
        name: t.name,
        issuer: t.issuer_name,
        chains,
        derivative: t.derivative,
        marketCap: tq?.marketCap ?? t.market_cap,
        exitRatio: tq?.volume24h != null && tq?.marketCap ? tq.volume24h / tq.marketCap : null,
        metrics: null,
        series: [],
        refused: [],
        mint: null,
        verdict: null,
        reason: '',
        today: tq ? { price: tq.price, supply: tq.supply, volume24h: tq.volume24h, capturedUtc: tq.capturedUtc } : undefined,
      };
      if (t.derivative) return { ...base, reason: 'derivative listing: no supply to mint' };
      const w = evaluateWrapper(base, hist.get(t.crypto_id) ?? [], map, chain.legs);
      // a chain read that FAILED on this click (rate limit, timeout) is not "the chain cannot be read": no verdict
      const failed = chain.errors.find((e) => map.legs.some((l) => e.startsWith(`${l.chain} RPC`)));
      if (failed && w.verdict === 'NOT_VERIFIABLE' && /^chain check unavailable/.test(w.mint?.reason ?? '')) {
        return { ...w, verdict: null, reason: `chain read failed on this click (${redact(failed).slice(0, 160)}); no verdict printed — run it again` };
      }
      return w;
    });

    return {
      underlying: { rwaId: full.rwa_id, ticker: full.symbol, name: full.name },
      window,
      range: { from, to, pinned },
      fetchedUtc,
      mode: rec.fallbacks.length ? 'live-stored' : 'live',
      live: rec.fallbacks.length === 0,
      cacheHit: false,
      liveCmcCalls,
      ...(rec.fallbacks.length
        ? {
            stored: rec.fallbacks.map((f) => ({ endpoint: f.endpoint, file: f.file, capturedUtc: f.capturedUtc, liveError: f.liveError })),
            history: { source: 'stored' as const, lastDay: span?.last || null, capturedUtc: histFb?.capturedUtc ?? null },
          }
        : {}),
      wrappers: sortWrappers(wrappers),
      receipts: rec.receipts,
      credits: rec.credits,
      elapsedMs: Math.round(performance.now() - t0),
      errors: chain.errors.map((m) => ({ source: 'rpc', message: redact(m) })),
    };
  } catch (e) {
    if (e instanceof CmcError) {
      // after the plan revert, a refusal no committed body can answer = a ticker outside the stored universe
      const outside = e.kind === 'entitlement' && rec.storedEnabled;
      throw new LookupFailure(e.kind === 'transient' || outside ? 503 : 502, redact(outside ? `${e.message} — outside the stored universe: no committed CMC body answers this request` : e.message), {
        cmcError: { code: e.code, message: redact(e.cmcMessage), endpoint: e.endpoint, httpStatus: e.httpStatus, class: e.kind },
        receipts: rec.receipts,
        credits: rec.credits,
      });
    }
    if (e instanceof LookupFailure) throw e;
    throw new LookupFailure(500, redact(`lookup failed: ${(e as Error)?.message ?? String(e)}`), { receipts: rec.receipts, credits: rec.credits });
  }
}

/** Pure per-wrapper evaluation (guard → net → mint check → verdict). Exported for tests and the snapshot. */
export function evaluateWrapper(
  base: WrapperResult,
  raw: RawDailyRow[],
  map: ContractMap,
  legsAll: Awaited<ReturnType<typeof legSupplies>>['legs'],
): WrapperResult {
  const { accepted, refused } = sanityGuard(raw);
  if (accepted.length < 2) {
    return { ...base, series: accepted, refused, reason: raw.length === 0 ? 'CMC returned no daily history for this window' : 'fewer than 2 accepted daily points: no verdict' };
  }
  const metrics = netCreation(accepted)!;
  const legs = legsAll.filter((l) => map.legs.some((m) => m.chain === l.chain && m.address === l.address));
  const { d, source } = issuerOffset(base.issuer);
  const A = accepted[0].date, B = accepted[accepted.length - 1].date;
  const mint = mintCheck({
    series: accepted,
    flows: metrics.flows,
    chainAt: summed(legs),
    legs: chainLegs(legs, addDays(A, d), addDays(B, d)),
    unreadable: map.unreadable,
    offset: d,
    offsetSource: source,
    chainSource: sourceOf(legs),
  });
  const v = decideVerdict(metrics, mint);
  const gaps = refused.filter((r) => r.reason === 'gap' && r.date > A && r.date < B).length;
  if (gaps && (v.verdict === 'REAL_INFLOW' || v.verdict === 'OUTFLOW')) {
    v.reason += ` · ${gaps} missing CMC day${gaps > 1 ? 's' : ''} inside the window: the supply move is chain-verified, the dollars across ${gaps > 1 ? 'them use' : 'it use'} the neighbouring days' average price`;
  }
  // a zero-address mint can only illustrate creation: never shown under OUTFLOW (a redemption is a burn)
  const proof = proofStep(accepted, metrics, summed(legs), d, mint.comparator);
  // mints.json `date` is the chain day (the step between block_at(date−1) and block_at(date)) → match CMC day D at D+d
  const chainDays = [...(proof ? [proof.date] : []), ...mint.stepDays.map((s) => s.date)].map((x) => addDays(x, d));
  const mintReceipt = v.verdict === 'REAL_INFLOW' ? pickMintReceipt(base.cryptoId, chainDays) : undefined;
  return { ...base, series: accepted, refused, metrics, mint, verdict: v.verdict, reason: v.reason, mintReceipt, proof };
}

/** Largest |flow| day in the window: CMC one-day step (comparator field) vs the chain's one-day step at the frozen d. */
export function proofStep(
  series: WrapperResult['series'],
  metrics: NonNullable<WrapperResult['metrics']>,
  chainAt: (date: string) => number | null,
  d: Offset,
  field: ProofStep['field'],
): ProofStep | undefined {
  const top = [...metrics.flows].sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow))[0];
  if (!top) return undefined;
  const i = series.findIndex((p) => p.date === top.date);
  if (i < 1) return undefined;
  const val = (p: (typeof series)[number]) => (field === 'total_supply' ? (p.totalSupply ?? p.supply) : p.supply);
  const cmcStep = val(series[i]) - val(series[i - 1]);
  const cd: [string, string] = [addDays(series[i - 1].date, d), addDays(series[i].date, d)];
  const c0 = chainAt(cd[0]), c1 = chainAt(cd[1]);
  const chainStep = c0 !== null && c1 !== null ? c1 - c0 : null;
  const errPct = chainStep !== null && cmcStep !== 0 ? (chainStep - cmcStep) / Math.abs(cmcStep) : null;
  const remedyBound = PARAMS.remedy * Math.abs(cmcStep), floorBound = PARAMS.floorFrac * val(series[series.length - 1]);
  const bound = Math.max(remedyBound, floorBound);
  const withinRemedy = chainStep === null || cmcStep === 0 ? null : Math.abs(chainStep - cmcStep) <= bound;
  return { date: series[i].date, prevDate: series[i - 1].date, field, cmcStep, chainStep, chainDates: cd, errPct, withinRemedy, bound, boundKind: floorBound > remedyBound ? 'floor' : 'remedy' };
}

function pickMintReceipt(cryptoId: number, stepDates: string[]): MintReceipt | undefined {
  const mine = cachedMints().filter((m) => m.crypto_id === cryptoId);
  for (const d of stepDates) {
    const hit = mine.find((m) => m.date === d); // mints.json date D = the chain step between block_at(D−1) and block_at(D)
    if (hit) return hit;
  }
  return undefined;
}

const RANK: Record<string, number> = { REAL_INFLOW: 0, OUTFLOW: 0, RECOUNT: 1, NOT_VERIFIABLE: 2, FLAT: 3 };
export function sortWrappers(ws: WrapperResult[]): WrapperResult[] {
  return [...ws].sort((a, b) => {
    if (a.derivative !== b.derivative) return a.derivative ? 1 : -1;
    const ra = a.verdict ? RANK[a.verdict] : 4, rb = b.verdict ? RANK[b.verdict] : 4;
    if (ra !== rb) return ra - rb;
    return Math.abs(b.metrics?.net ?? 0) - Math.abs(a.metrics?.net ?? 0);
  });
}

export { heroOf } from './hero';
