/**
 * GET /api/holders?u=<ticker|rwa_id>
 * Holder addresses per chain for every wrapper of one underlying (CMC /v1/dex/holders/count, 1 credit per leg), with receipts.
 * A holder count is addresses, not people: exchanges and omnibus accounts are one address each.
 */
import { NextResponse } from 'next/server';
import { holders } from '@/lib/holders';
import { LookupFailure } from '@/lib/lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const u = (new URL(req.url).searchParams.get('u') ?? '').trim();
  if (!u || u.length > 20 || !/^[A-Za-z0-9.\-]+$/.test(u)) return NextResponse.json({ error: 'u must be a ticker or rwa_id (letters, digits, . or -)' }, { status: 400 });
  try {
    return NextResponse.json(await holders(u), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof LookupFailure) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.httpStatus });
    return NextResponse.json({ error: `holders failed: ${(e as Error).message}` }, { status: 500 });
  }
}
