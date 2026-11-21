/** /u?t=NVDA (the search form) → /u/NVDA */
import { NextResponse } from 'next/server';

export function GET(req: Request) {
  const url = new URL(req.url);
  const t = (url.searchParams.get('t') ?? '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  return NextResponse.redirect(new URL(t ? `/u/${t}` : '/', url.origin), 303);
}
