'use client';
import { useCallback, useState } from 'react';
import { VerdictStamp } from './VerdictStamp';
import { ProofRows } from './ProofRows';
import { ReceiptDrawer } from './ReceiptDrawer';
import { ErrorBanner, type LookupError } from './ErrorBanner';
import { pct, times, usd, utcStamp } from '@/lib/format';
import { citeLine } from '@/lib/cite';
import type { LookupResult, LookupWindow, WrapperResult } from '@/lib/types';

function heroOf(r: LookupResult): { wrapper: WrapperResult | null; verified: boolean } {
  const scored = r.wrappers.filter((w) => w.metrics && w.verdict);
  const verified = scored.filter((w) => w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW');
  const pick = (xs: WrapperResult[]) => [...xs].sort((a, b) => Math.abs(b.metrics!.net) - Math.abs(a.metrics!.net))[0] ?? null;
  return verified.length ? { wrapper: pick(verified), verified: true } : { wrapper: pick(scored), verified: false };
}

const chainNames = (w: WrapperResult) => w.chains.slice(0, 2).join(' + ');

/** S1 hero: the strongest verified wrapper, its stamp, net creation, 2 proving rows, "Run it live", Cite, receipts. */
export function HeroCard({ initial, initialError, u }: { initial: LookupResult | null; initialError: LookupError | null; u: string }) {
  const [res, setRes] = useState<LookupResult | null>(initial);
  const [err, setErr] = useState<LookupError | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState<LookupWindow>(initial?.window ?? 30);
  const [strikeKey, setStrikeKey] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(
    async (w: LookupWindow) => {
      setBusy(true);
      setWin(w);
      try {
        const r = await fetch(`/api/lookup?u=${encodeURIComponent(u)}&window=${w}`, { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) {
          setErr({ status: r.status, at: new Date().toISOString(), ...j });
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
    [u],
  );

  const hero = res ? heroOf(res) : { wrapper: null, verified: false };
  const w = hero.wrapper;
  const m = w?.metrics;
  const ink = m && m.net < 0 ? 'debit' : 'credit';

  return (
    <section className="card" aria-live="polite">
      {err ? <ErrorBanner e={err} /> : null}
      {res && !hero.verified ? <p className="note">No wrapper passed the mint check in this window. Largest move shown with its actual verdict.</p> : null}
      {res && w && m && w.verdict ? (
        <>
          <p className="eyebrow">
            {res.underlying.name} · {res.range.from} → {res.range.to} UTC · {res.window ?? 'pinned'} {res.window ? 'd' : ''}
          </p>
          <div className="hero-top">
            <VerdictStamp key={strikeKey} verdict={w.verdict} animate sub height={64} />
            <div>
              <p className="hero-sub">
                <strong className="data">{w.symbol}</strong> · {w.issuer} · {chainNames(w)}
              </p>
              <p className={`hero-figure ${ink}`}>{usd(m.net)}</p>
              <p className="hero-sub">
                net {m.net >= 0 ? 'creation' : 'redemption'} · units {times(m.unitsX)} · price {pct(m.pricePct)}
              </p>
            </div>
          </div>
          <ProofRows w={w} />
          <p className="definition">Counted the way ETF flow tables count creations: units created or redeemed × price ($ at wrapper market price).</p>
        </>
      ) : null}
      <div className="actions">
        <button className="btn" onClick={() => run(win)} disabled={busy}>
          {busy ? 'Running live…' : 'Run it live'}
        </button>
        <div className="seg" role="group" aria-label="Window">
          {([7, 30, 90] as LookupWindow[]).map((x) => (
            <button key={x} aria-pressed={win === x} onClick={() => run(x)} disabled={busy}>
              {x} d
            </button>
          ))}
        </div>
        {res && w ? (
          <button
            className="btn quiet"
            onClick={async () => {
              await navigator.clipboard?.writeText(citeLine(res, w, window.location.origin));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? 'Copied' : 'Cite'}
          </button>
        ) : null}
        {res ? (
          <button className="btn quiet" onClick={() => setDrawer(true)}>
            Receipts ({res.receipts.filter((r) => r.kind === 'cmc').length})
          </button>
        ) : null}
        <a className="btn quiet" href={`/u/${encodeURIComponent(u)}`} style={{ textDecoration: 'none' }}>
          Every {u} wrapper →
        </a>
      </div>
      {res ? (
        <p className="capture">
          {res.live ? 'live' : res.mode} capture {utcStamp(res.fetchedUtc)} · {res.credits} CMC credits · {res.elapsedMs} ms
          {w?.mint ? ` · chain data: ${w.mint.chainSource === 'baseline' ? 'committed daily baseline' : w.mint.chainSource}` : ''}
        </p>
      ) : null}
      {drawer && res ? <ReceiptDrawer receipts={res.receipts} credits={res.credits} onClose={() => setDrawer(false)} /> : null}
    </section>
  );
}
