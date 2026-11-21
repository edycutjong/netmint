/**
 * The one core flow: underlying → every wrapper → daily supply history → sanity guard → net creation →
 * mint check against the chain → verdict, with a receipt for every external call.
 * Used by /api/lookup, `npm run demo`, `npm run snapshot` and the hero card.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Recorder, redact } from './receipts';
import { resolveUnderlying, wrappersOf } from './cmc/rwa';
import { addDays, dailyHistory } from './cmc/history';
import { contractMaps, type ContractMap } from './cmc/info';
import { latestQuotes } from './cmc/quotes';
import { CmcError } from './cmc/errors';
import { sanityGuard } from './flow/sanity';
import { netCreation } from './flow/netCreation';
import { mintCheck } from './flow/mintCheck';
import { decideVerdict } from './flow/verdict';
import type { Offset } from './flow/params';
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
}

export async function lookup(u: string, opts: LookupOpts = {}): Promise<LookupResult> {
  const t0 = performance.now();
  const rec = opts.rec ?? new Recorder();
  const fetchedUtc = new Date(opts.nowMs ?? Date.now()).toISOString();
  const pinned = Boolean(opts.from && opts.to);
  if (pinned && (!DATE_RE.test(opts.from!) || !DATE_RE.test(opts.to!) || opts.from! >= opts.to!)) {
    throw new LookupFailure(400, 'from/to must be YYYY-MM-DD with from < to');
  }
  const window: LookupWindow | null = pinned ? null : (opts.window ?? 30);
  const to = pinned ? opts.to! : todayUtc(opts.nowMs);
  const from = pinned ? opts.from! : addDays(to, -(window as number));

  try {
    const { asset, suggestions } = await resolveUnderlying(rec, u);
    if (!asset) throw new LookupFailure(404, `No tokenised wrappers on CMC for '${u}'`, { suggestions, receipts: rec.receipts, credits: rec.credits });
    const { asset: full, tokens } = await wrappersOf(rec, asset.rwa_id);
    const live = tokens.filter((t) => !t.derivative);
    const ids = live.map((t) => t.crypto_id);

    const [hist, maps, today] = await Promise.all([
      dailyHistory(rec, ids, from, to),
      contractMaps(rec, ids),
      latestQuotes(rec, ids),
    ]);

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
      return evaluateWrapper(base, hist.get(t.crypto_id) ?? [], map, chain.legs);
    });

    return {
      underlying: { rwaId: full.rwa_id, ticker: full.symbol, name: full.name },
      window,
      range: { from, to, pinned },
      fetchedUtc,
      mode: 'live',
      live: true,
      cacheHit: false,
      wrappers: sortWrappers(wrappers),
      receipts: rec.receipts,
      credits: rec.credits,
      elapsedMs: Math.round(performance.now() - t0),
      errors: chain.errors.map((m) => ({ source: 'rpc', message: redact(m) })),
    };
  } catch (e) {
    if (e instanceof CmcError) {
      throw new LookupFailure(e.kind === 'transient' ? 503 : 502, redact(e.message), {
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
  const verified = v.verdict === 'REAL_INFLOW' || v.verdict === 'OUTFLOW';
  const proof = proofStep(accepted, metrics, summed(legs), d, mint.comparator);
  const stepDates = [...(proof ? [proof.date] : []), ...mint.stepDays.map((s) => s.date)];
  const mintReceipt = verified ? pickMintReceipt(base.cryptoId, stepDates) : undefined;
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
  return { date: series[i].date, prevDate: series[i - 1].date, field, cmcStep, chainStep, chainDates: cd, errPct, withinRemedy: errPct === null ? null : Math.abs(errPct) <= 0.1 };
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
