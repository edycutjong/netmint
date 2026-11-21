/**
 * GET /api/lookup?u=<ticker|rwa_id>&window=7|30|90   (or &from=YYYY-MM-DD&to=YYYY-MM-DD, pinned)
 * Runs the core flow live: CMC calls + chain reads + verdicts, with every receipt. Never a verdict on a CMC error.
 * A 60 s in-memory de-dupe keyed on (u, window, from, to) answers repeats with live: false, cacheHit: true.
 */
import { NextResponse } from 'next/server';
import { lookup, LookupFailure } from '@/lib/lookup';
import { parseLookupParams } from '@/lib/lookupParams';
import type { LookupResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEDUPE_MS = 60_000;
const BUDGET_MS = 55_000; // answer before Vercel's 60 s kill: a slow CMC or RPC day is a 503 with a reason, never a bare 504
const recent = new Map<string, { at: number; result: LookupResult }>();

export async function GET(req: Request) {
  const p = parseLookupParams(new URL(req.url).searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400, headers: { 'cache-control': 'no-store' } });
  const hit = recent.get(p.key);
  if (hit && Date.now() - hit.at < DEDUPE_MS) {
    // a repeat within 60 s is labelled cached; a live-stored answer keeps its mode so the plan refusal stays visible
    const mode: LookupResult['mode'] = hit.result.mode === 'live' ? 'cached' : hit.result.mode;
    return NextResponse.json({ ...hit.result, live: false, cacheHit: true, mode }, { headers: { 'cache-control': 'no-store' } });
  }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LookupFailure(503, `lookup ran past its ${BUDGET_MS / 1000} s budget (slow CMC or chain RPC); no verdict printed — run it again`)), BUDGET_MS);
    });
    const result = await Promise.race([lookup(p.u, { window: p.window, from: p.from, to: p.to, storedFallback: true }), budget]).finally(() => clearTimeout(timer));
    recent.set(p.key, { at: Date.now(), result });
    for (const [k, v] of recent) if (Date.now() - v.at > DEDUPE_MS) recent.delete(k);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof LookupFailure) {
      return NextResponse.json({ error: e.message, ...e.extra, verdict: null }, { status: e.httpStatus, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ error: `lookup failed: ${(e as Error).message}`, verdict: null }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
