'use client';
import { Fragment, useState } from 'react';
import { VerdictStamp } from './VerdictStamp';
import { ProofRows } from './ProofRows';
import { pct, plain, times, units, usd } from '@/lib/format';
import { citeLine } from '@/lib/cite';
import type { LookupResult, WrapperResult } from '@/lib/types';

/** S2 wrapper ledger: one row per wrapper, stamps struck in staggered 60 ms; derivative listings greyed at the bottom. */
export function Ledger({ res, strikeKey }: { res: LookupResult; strikeKey: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <div className="wrap-x">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Verdict</th>
            <th scope="col">Wrapper</th>
            <th scope="col" className="hide-sm">
              Chains
            </th>
            <th scope="col">Net creation</th>
            <th scope="col" className="hide-sm">
              Gross in
            </th>
            <th scope="col" className="hide-sm">
              Gross out
            </th>
            <th scope="col">Units ×</th>
            <th scope="col">Price</th>
            <th scope="col" className="hide-sm">
              Coverage
            </th>
            <th scope="col" className="hide-sm" title="24h volume ÷ market cap (today)">
              Exit ratio
            </th>
          </tr>
        </thead>
        <tbody>
          {res.wrappers.map((w, i) => {
            const m = w.metrics;
            const isOpen = open === w.cryptoId;
            // only a chain-confirmed move is net creation; otherwise the figure is CMC's supply change × price, shown as unproven (as on /flows)
            const proven = w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW';
            return (
              <Fragment key={w.cryptoId}>
                <tr className={w.derivative ? 'derivative' : undefined}>
                  <td>
                    {w.verdict ? (
                      <VerdictStamp key={`${strikeKey}-${w.cryptoId}`} verdict={w.verdict} animate height={26} delayMs={i * 60} />
                    ) : (
                      <span className="muted">{w.derivative ? 'derivative' : 'no verdict'}</span>
                    )}
                  </td>
                  <td>
                    <strong className="data">{w.symbol}</strong> <span className="muted">· {w.issuer}</span>
                    <div className="reason">{w.reason}</div>
                    {!w.derivative ? (
                      <button className="expand" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : w.cryptoId)}>
                        {isOpen ? 'hide detail' : 'proof + detail'}
                      </button>
                    ) : null}
                  </td>
                  <td className="hide-sm">{w.chains.join(', ') || '—'}</td>
                  {m && !proven ? (
                    <td
                      className="num money muted"
                      title="CMC supply change × price; the chain does not confirm it, so it is not net creation"
                    >
                      CMC Δ {usd(m.net)}
                      <div className="unproven">{w.verdict === 'FLAT' ? 'under threshold' : 'unproven'}</div>
                    </td>
                  ) : (
                    <td className={`num money ${m && m.net < 0 ? 'debit' : ''}`}>{m ? usd(m.net) : ''}</td>
                  )}
                  {/* gross creation/redemption is only shown when the chain confirms the moves; otherwise it would read as inflow */}
                  <td className={`num hide-sm ${proven ? '' : 'muted'}`} title={proven ? undefined : 'not shown: the chain does not confirm this wrapper\'s moves'}>
                    {m ? (proven ? usd(m.grossIn) : '—') : ''}
                  </td>
                  <td className={`num hide-sm ${proven ? 'debit' : 'muted'}`} title={proven ? undefined : 'not shown: the chain does not confirm this wrapper\'s moves'}>
                    {m ? (proven ? usd(m.grossOut) : '—') : ''}
                  </td>
                  <td className="num">{m ? times(m.unitsX) : ''}</td>
                  <td className={`num ${m && m.pricePct < 0 ? 'debit' : ''}`}>{m ? pct(m.pricePct) : ''}</td>
                  <td className="num hide-sm">{w.mint?.coverageA != null ? `${(w.mint.coverageA * 100).toFixed(1)}%` : '—'}</td>
                  <td className="num hide-sm">{w.exitRatio != null ? `${(w.exitRatio * 100).toFixed(1)}%` : '—'}</td>
                </tr>
                {isOpen ? (
                  <tr className="detail">
                    <td colSpan={10}>
                      <Detail w={w} />
                      <button
                        className="btn quiet"
                        style={{ marginTop: 10 }}
                        onClick={async () => {
                          await navigator.clipboard?.writeText(citeLine(res, w, window.location.origin));
                          setCopied(w.cryptoId);
                          setTimeout(() => setCopied(null), 1600);
                        }}
                      >
                        {copied === w.cryptoId ? 'Copied' : 'Cite this row'}
                      </button>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ w }: { w: WrapperResult }) {
  const m = w.metrics;
  const top = m ? [...m.flows].sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow)).slice(0, 5) : [];
  return (
    <div>
      <ProofRows w={w} />
      {w.mint?.stepDays.length ? (
        <>
          <h3 className="section-h" style={{ marginTop: 18 }}>
            Material step days (3-day sums; the largest days, up to 5)
          </h3>
          <table className="ledger plain">
            <thead>
              <tr>
                <th>Day</th>
                <th>CMC 3-day</th>
                <th>Chain 3-day</th>
                <th>Found</th>
              </tr>
            </thead>
            <tbody>
              {w.mint.stepDays.map((s) => (
                <tr key={s.date}>
                  <td className="num">{s.date}</td>
                  <td className="num">{units(s.cmc3d)}</td>
                  <td className="num">{s.chain3d === null ? 'n/a' : units(s.chain3d)}</td>
                  <td className={s.ok ? '' : 'debit'}>{s.ok ? 'within remedy' : 'outside remedy'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {top.length ? (
        <>
          <h3 className="section-h" style={{ marginTop: 18 }}>
            Largest supply steps (CMC circulating, $ at wrapper market price)
          </h3>
          <table className="ledger plain">
            <thead>
              <tr>
                <th>Day</th>
                <th>Units</th>
                <th>Flow</th>
              </tr>
            </thead>
            <tbody>
              {top.map((f) => (
                <tr key={f.date}>
                  <td className="num">{f.date}</td>
                  <td className="num">{units(f.deltaS)}</td>
                  <td className={`num ${f.flow < 0 ? 'debit' : ''}`}>{usd(f.flow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="capture" style={{ marginTop: 12 }}>
        {w.series.length} accepted daily points · supply {m ? `${plain(m.supplyA)} → ${plain(m.supplyB)}` : 'n/a'} ·{' '}
        {w.refused.length
          ? `${w.refused.length} rows refused: ${w.refused.map((r) => `${r.reason.replace('_', ' ')} on ${r.date} (${r.detail})`).join('; ')}`
          : 'no rows refused'}
        {w.mint
          ? ` · comparator: CMC ${w.mint.comparator.replace('_', ' ')} · d = ${w.mint.offset} (${w.mint.offsetSource === 'issuer' ? 'measured per issuer' : 'default'})`
          : ''}
      </p>
    </div>
  );
}
