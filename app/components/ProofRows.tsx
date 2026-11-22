import { pct, plain, short, units } from '@/lib/format';
import type { WrapperResult } from '@/lib/types';

/** The two proving rows beside every verdict: CMC's step vs the chain's step, then the jury's verdict line. */
export function ProofRows({ w }: { w: WrapperResult }) {
  const p = w.proof;
  const m = w.mint;
  if (!m) return null;
  const field = m.comparator === 'total_supply' ? 'total supply' : 'circulating supply';
  const recount = w.verdict === 'RECOUNT';
  return (
    <div className="proof">
      {p ? (
        <>
          <div className="proof-row">
            <span className="lbl">Proof 1</span>
            <span>
              CMC {field} {p.prevDate} → {p.date}
            </span>
            <span className={`fig${recount ? ' struck' : ''}`}>{units(p.cmcStep)}</span>
          </div>
          <div className="proof-row">
            <span className="lbl">Proof 2</span>
            <span>
              chain totalSupply {p.chainDates[0]} → {p.chainDates[1]} ·{' '}
              {m.legs.map((l) => (l.chain === 'bsc' ? 'BNB Chain' : 'Ethereum')).join(' + ') || 'no readable leg'}
              {' · '}
              <span style={{ whiteSpace: 'nowrap' }}>d = {m.offset}</span>
            </span>
            <span className="fig">{p.chainStep === null ? 'n/a' : units(p.chainStep)}</span>
          </div>
          {p.errPct !== null ? (
            <p className="verdict-line" style={{ margin: '6px 0 0' }}>
              1-day step {p.date}: chain vs CMC {pct(p.errPct)}
              {p.boundKind === 'floor'
                ? `${p.withinRemedy ? ' · within' : ' · outside'} the floor ±${units(p.bound ?? 0)} (0.5% of supply, larger than ±10% of this step)`
                : p.withinRemedy
                  ? ' · within remedy (tolerance ±10%)'
                  : ' · outside remedy (tolerance ±10%)'}
            </p>
          ) : null}
        </>
      ) : null}
      {m.cmcDelta !== null && m.chainDelta !== null && m.coverageA !== null ? (
        <div className="proof-row">
          <span className="lbl">Window</span>
          <span>
            {w.series[0]?.date} → {w.series[w.series.length - 1]?.date}: chain {units(m.chainDelta)} · CMC {units(m.cmcDelta)} · coverage{' '}
            {(m.coverageA * 100).toFixed(1)}% at the start
          </span>
          <span className="fig">{m.errPct === null ? '' : `chain vs CMC ${pct(m.errPct)}`}</span>
        </div>
      ) : null}
      <p className={`verdict-line${m.status === 'pass' ? ' pass' : ''}`}>
        Found:{' '}
        {m.status === 'pass'
          ? `window and material steps verified: ${w.reason.split(/ · \d+ missing CMC days? inside the window/)[0].replace(/^window endpoints and the largest step days \(up to 5\) verified \((.*)\)$/, '$1')}`
          : w.reason}
      </p>
      {w.mintReceipt ? (
        <p className="capture" style={{ margin: '6px 0 0' }}>
          One of the day’s mints ({plain(w.mintReceipt.amount)} units
          {p?.chainStep && w.mintReceipt.date === p.chainDates[1]
            ? ` of the ${units(p.chainStep)} chain step that day`
            : ` on ${w.mintReceipt.date}`}
          ):{' '}
          <a className="data" href={w.mintReceipt.explorer_url} target="_blank" rel="noreferrer">
            {short(w.mintReceipt.tx, 8, 6)}
          </a>{' '}
          (block <span className="data">{w.mintReceipt.block}</span>) → recipient{' '}
          <span className="data">{short(w.mintReceipt.recipient, 6, 5)}</span>. A mint can only be executed by the token’s minter.
        </p>
      ) : null}
    </div>
  );
}
