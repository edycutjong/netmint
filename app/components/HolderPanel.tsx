'use client';
import { useEffect, useState } from 'react';
import { ReceiptDrawer } from './ReceiptDrawer';
import { ErrorBanner, type LookupError } from './ErrorBanner';
import { plain, short, utcStamp } from '@/lib/format';
import type { HoldersResult } from '@/lib/holders';

/** Holder panel: addresses per chain per wrapper (CMC /v1/dex/holders/count, live) + the mint recipient of a verified step. */
export function HolderPanel({ u }: { u: string }) {
  const [res, setRes] = useState<HoldersResult | null>(null);
  const [err, setErr] = useState<LookupError | null>(null);
  const [busy, setBusy] = useState(true);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    fetch(`/api/holders?u=${encodeURIComponent(u)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!live) return;
        if (!r.ok) setErr({ status: r.status, at: new Date().toISOString(), ...j });
        else {
          setRes(j);
          setErr(null);
        }
      })
      .catch((e) => live && setErr({ status: 0, at: new Date().toISOString(), error: `network error: ${(e as Error).message}` }))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [u]);

  return (
    <section className="holders" aria-labelledby="holders-h" style={{ marginTop: 34 }}>
      <h2 id="holders-h" className="section-h">
        Holder addresses per wrapper
      </h2>
      {busy ? <p className="capture">Asking CoinMarketCap for holder counts per chain…</p> : null}
      {err ? <ErrorBanner e={err} /> : null}
      {res ? (
        <>
          <p className="capture">
            {utcStamp(res.fetchedUtc)} · {res.credits} credits charged by CMC · {res.elapsedMs} ms{' '}
            <button className="btn quiet" onClick={() => setDrawer(true)} style={{ marginLeft: 8 }}>
              Receipts ({res.receipts.filter((r) => r.kind === 'cmc').length})
            </button>
          </p>
          <div className="wrap-x">
            <table className="ledger plain" aria-label="Holder addresses per wrapper">
              <thead>
                <tr>
                  <th scope="col">Wrapper</th>
                  <th scope="col">Issuer</th>
                  <th scope="col">Holder addresses (BNB Chain + Ethereum)</th>
                  <th scope="col">Per chain</th>
                  <th scope="col">Sampled mint recipient</th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.cryptoId}>
                    <td className="data">{r.symbol}</td>
                    <td>{r.issuer}</td>
                    <td className="num">{r.total === null ? 'n/a' : `${r.unreadable.length || r.legs.some((l) => l.count === null) ? '≥ ' : ''}${plain(r.total)}`}</td>
                    <td>
                      {r.legs.map((l) => (
                        <div key={`${l.chain}-${l.address}`} className="data" style={{ fontSize: 13 }}>
                          {l.chain === 'bsc' ? 'BNB Chain' : 'Ethereum'} {l.count === null ? `unavailable (${l.error})` : plain(l.count)}
                        </div>
                      ))}
                      {r.unreadable.length ? (
                        <div className="muted" style={{ fontSize: 13 }}>
                          {r.unreadable.join(', ')}: not read here
                        </div>
                      ) : null}
                      {!r.legs.length && !r.unreadable.length ? <span className="muted">no contract listed</span> : null}
                    </td>
                    <td>
                      {r.mintRecipient ? (
                        <a className="data" href={`${r.mintRecipient.explorer_url}`} target="_blank" rel="noreferrer">
                          {short(r.mintRecipient.recipient, 8, 6)}
                        </a>
                      ) : (
                        <span className="muted">none checked</span>
                      )}
                      {r.mintRecipient ? <div className="muted" style={{ fontSize: 12 }}>one sampled mint, {plain(r.mintRecipient.amount)} units, {r.mintRecipient.date} (committed, not live)</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="definition">
            A holder count is addresses, not people: an exchange or omnibus account is one address. Counts are CMC’s <span className="data">/v1/dex/holders/count</span>{' '}
            per chain; “≥” means other chains the endpoint is not asked about (or a failed leg) are not included. The mint recipient is one on-chain mint sampled on a step day by <span className="data">scripts/find-mint.ts</span> and committed in <span className="data">data/mints.json</span>; it is not every mint and not a live read.
          </p>
        </>
      ) : null}
      {drawer && res ? <ReceiptDrawer receipts={res.receipts} credits={res.credits} onClose={() => setDrawer(false)} /> : null}
    </section>
  );
}
