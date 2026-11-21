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
const recent = new Map<string, { at: number; result: LookupResult }>();

export async function GET(req: Request) {
  const p = parseLookupParams(new URL(req.url).searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const hit = recent.get(p.key);
  if (hit && Date.now() - hit.at < DEDUPE_MS) {
    return NextResponse.json({ ...hit.result, live: false, cacheHit: true, mode: 'cached' satisfies LookupResult['mode'] });
  }
  try {
    const result = await lookup(p.u, { window: p.window, from: p.from, to: p.to, storedFallback: true });
    recent.set(p.key, { at: Date.now(), result });
    for (const [k, v] of recent) if (Date.now() - v.at > DEDUPE_MS) recent.delete(k);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof LookupFailure) {
      return NextResponse.json({ error: e.message, ...e.extra, verdict: null }, { status: e.httpStatus });
    }
    return NextResponse.json({ error: `lookup failed: ${(e as Error).message}`, verdict: null }, { status: 500 });
  }
}
