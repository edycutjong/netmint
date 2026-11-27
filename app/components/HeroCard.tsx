'use client';
import { useCallback, useRef, useState } from 'react';
import { VerdictStamp } from './VerdictStamp';
import { ProofRows } from './ProofRows';
import { ReceiptDrawer } from './ReceiptDrawer';
import { ErrorBanner, type LookupError } from './ErrorBanner';
import { pct, times, usd, utcStamp } from '@/lib/format';
import { citeLine } from '@/lib/cite';
import { heroOf } from '@/lib/hero';
import type { LookupResult, LookupWindow, WrapperResult } from '@/lib/types';
import { StoredNotice, storedDays, storedStamp } from './StoredNotice';

const chainNames = (w: WrapperResult) => w.chains.slice(0, 2).join(' + ');

/** Query for the per-stock page: the pinned days, or the rolling length. Without it the page runs today's rolling 30 d, whose verdicts can differ. */
const ledgerQuery = (res: LookupResult | null) =>
  !res ? '' : res.range.pinned ? `?from=${res.range.from}&to=${res.range.to}` : res.window ? `?window=${res.window}` : '';

/** S1 hero: the strongest verified wrapper, its stamp, net creation, 2 proving rows, "Run it live", Cite, receipts. */
export function HeroCard({ initial, initialError, u }: { initial: LookupResult | null; initialError: LookupError | null; u: string }) {
  const [res, setRes] = useState<LookupResult | null>(initial);
  const [err, setErr] = useState<LookupError | null>(initialError);
  const [busy, setBusy] = useState(false);
  // the rolling window the chips show; null while the card shows (or is running) the pinned window, which is no chip's window
  const [win, setWin] = useState<LookupWindow | null>(initial ? initial.window : 30);
  const [strikeKey, setStrikeKey] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [copied, setCopied] = useState(false);
  // the window of the answer on the card: a failed run puts the chips back on it (the card still shows that answer)
  const shownWin = useRef<LookupWindow | null>(initial ? initial.window : 30);

  // "Run it live" re-runs the window on screen (the pinned hero window, or the chosen rolling one); chips pick a rolling window
  const run = useCallback(
    async (w: LookupWindow | null, pin?: { from: string; to: string }) => {
      setBusy(true);
      setWin(pin ? null : w);
      try {
        const q = pin ? `from=${pin.from}&to=${pin.to}` : `window=${w ?? 30}`;
        const r = await fetch(`/api/lookup?u=${encodeURIComponent(u)}&${q}`, { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) {
          setErr({ status: r.status, at: new Date().toISOString(), ...j });
          setWin(shownWin.current);
        } else {
          setRes(j);
          setErr(null);
          shownWin.current = pin ? null : w;
          setStrikeKey((k) => k + 1);
        }
      } catch (e) {
        setErr({ status: 0, at: new Date().toISOString(), error: `network error: ${(e as Error).message}` });
        setWin(shownWin.current);
      } finally {
        setBusy(false);
      }
    },
    [u],
  );

  const hero = res ? heroOf(res) : { wrapper: null, verified: false };
  const w = hero.wrapper;
  const m = w?.metrics;
  const ink = !hero.verified ? '' : m && m.net < 0 ? 'debit' : 'credit';

  return (
    <section className="card" aria-live="polite">
      {err ? <ErrorBanner e={err} /> : null}
      {err && res ? (
        <p className="note">
          That run printed no verdict. The card below is the earlier answer (
          {res.mode === 'recorded'
            ? `recorded capture ${utcStamp(res.recordedUtc ?? res.fetchedUtc)}`
            : `${res.live ? 'live' : res.mode} capture ${utcStamp(res.fetchedUtc)}${storedDays(res) ? `, on stored CMC bodies captured ${storedDays(res)}` : ''}`}
          ), not a new one.
        </p>
      ) : null}
      {res && !hero.verified ? (
        <p className="note">No wrapper passed the mint check in this window. Largest move shown with its actual verdict.</p>
      ) : null}
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
                {hero.verified ? `net ${m.net >= 0 ? 'creation' : 'redemption'}` : 'CMC supply change × price, unproven'} · units{' '}
                {times(m.unitsX)} · price {pct(m.pricePct)}
              </p>
            </div>
          </div>
          <ProofRows w={w} />
          <p className="definition">
            {hero.verified
              ? 'Counted the way ETF flow tables count creations: units created or redeemed × price ($ at wrapper market price).'
              : 'CMC supply change × price ($ at wrapper market price). It becomes net creation only when the chain confirms it.'}
          </p>
        </>
      ) : null}
      <div className="actions">
        <button
          className="btn"
          onClick={() => run(win, res?.range.pinned ? { from: res.range.from, to: res.range.to } : undefined)}
          disabled={busy}
        >
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
        {/* keeps the card's window: a pinned answer links to the same pinned days, a rolling one to a rolling window of the same length */}
        <a className="btn quiet" href={`/u/${encodeURIComponent(u)}${ledgerQuery(res)}`} style={{ textDecoration: 'none' }}>
          Every {u} wrapper →
        </a>
      </div>
      {res ? <StoredNotice res={res} /> : null}
      {res ? (
        <p className="capture">
          {res.mode === 'recorded'
            ? `recorded capture ${utcStamp(res.recordedUtc ?? res.fetchedUtc)} · replayed from the committed CMC responses (no CMC call on page load) · Run it live calls CMC now; if CMC refuses a call (plan, credits or a disabled key), a stored dated CMC body answers it, labelled`
            : `${res.live ? 'live' : res.mode} capture ${utcStamp(res.fetchedUtc)}${storedStamp(res)} · ${res.credits} credits charged by CMC for this lookup (status.credit_count; repeat identical calls are not charged) · ${res.elapsedMs} ms`}
          {w && w.series.length > 1 && (w.series[0].date !== res.range.from || w.series[w.series.length - 1].date !== res.range.to)
            ? ` · math over ${w.series[0].date} → ${w.series[w.series.length - 1].date} (accepted CMC days)`
            : ''}
          {w?.mint ? ` · chain data: ${w.mint.chainSource === 'baseline' ? 'committed daily baseline' : w.mint.chainSource}` : ''}
        </p>
      ) : null}
      {drawer && res ? <ReceiptDrawer receipts={res.receipts} credits={res.credits} onClose={() => setDrawer(false)} /> : null}
    </section>
  );
}
