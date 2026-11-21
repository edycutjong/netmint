'use client';
import { useCallback, useEffect, useState } from 'react';
import { Ledger } from './Ledger';
import { ReceiptDrawer } from './ReceiptDrawer';
import { ErrorBanner, type LookupError } from './ErrorBanner';
import { utcStamp } from '@/lib/format';
import type { LookupResult, LookupWindow } from '@/lib/types';

/** S2: a click fires /api/lookup live; every wrapper of the stock gets a verdict row. */
export function LookupView({ u, from, to, initialWindow }: { u: string; from?: string; to?: string; initialWindow: LookupWindow }) {
  const [res, setRes] = useState<LookupResult | null>(null);
  const [err, setErr] = useState<LookupError | null>(null);
  const [busy, setBusy] = useState(true);
  const [win, setWin] = useState<LookupWindow>(initialWindow);
  const [pinned, setPinned] = useState(Boolean(from && to));
  const [strikeKey, setStrikeKey] = useState(0);
  const [drawer, setDrawer] = useState(false);

  const run = useCallback(
    async (w: LookupWindow, pin: boolean) => {
      setBusy(true);
      const qs = pin && from && to ? `from=${from}&to=${to}` : `window=${w}`;
      try {
        const r = await fetch(`/api/lookup?u=${encodeURIComponent(u)}&${qs}`, { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) {
          setErr({ status: r.status, at: new Date().toISOString(), ...j });
          setRes(null);
        } else {
          setRes(j);
          setErr(null);
          setStrikeKey((k) => k + 1);
        }
      } catch (e) {
        setErr({ status: 0, at: new Date().toISOString(), error: `network error: ${(e as Error).message}` });
      } finally {
        setBusy(false);
      }
    },
    [u, from, to],
  );

  useEffect(() => {
    run(initialWindow, Boolean(from && to));
  }, [run, initialWindow, from, to]);

  return (
    <section>
      <div className="actions" style={{ marginTop: 0, marginBottom: 16 }}>
        <div className="seg" role="group" aria-label="Window">
          {([7, 30, 90] as LookupWindow[]).map((x) => (
            <button
              key={x}
              aria-pressed={!pinned && win === x}
              disabled={busy}
              onClick={() => {
                setWin(x);
                setPinned(false);
                run(x, false);
              }}
            >
              {x} d
            </button>
          ))}
        </div>
        <button className="btn" disabled={busy} onClick={() => run(win, pinned)}>
          {busy ? 'Running live…' : 'Run it live'}
        </button>
        {res ? (
          <button className="btn quiet" onClick={() => setDrawer(true)}>
            Receipts ({res.receipts.filter((r) => r.kind === 'cmc').length})
          </button>
        ) : null}
      </div>
      {err ? <ErrorBanner e={err} /> : null}
      {busy && !res ? <p className="capture">Calling CoinMarketCap and reading the chain…</p> : null}
      {res ? (
        <>
          <p className="capture">
            {res.underlying.name} · {res.range.from} → {res.range.to} UTC {res.range.pinned ? '· pinned window' : `· ${res.window} d`} ·{' '}
            {res.live ? 'live' : res.mode} {utcStamp(res.fetchedUtc)} · {res.credits} CMC credits · {res.elapsedMs} ms
          </p>
          <Ledger res={res} strikeKey={strikeKey} />
          <p className="definition">Counted the way ETF flow tables count creations: units created or redeemed × price ($ at wrapper market price). REAL INFLOW and OUTFLOW are issuer-level net creation and redemption verified on chain, not buyer data.</p>
        </>
      ) : null}
      {drawer && res ? <ReceiptDrawer receipts={res.receipts} credits={res.credits} onClose={() => setDrawer(false)} /> : null}
    </section>
  );
}
