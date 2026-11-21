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
              CMC {field} {p.prevDate.slice(5)} → {p.date.slice(5)}
            </span>
            <span className={`fig${recount ? ' struck' : ''}`}>{units(p.cmcStep)}</span>
          </div>
          <div className="proof-row">
            <span className="lbl">Proof 2</span>
            <span>
              chain totalSupply {p.chainDates[0].slice(5)} → {p.chainDates[1].slice(5)} · {m.legs.map((l) => (l.chain === 'bsc' ? 'BNB Chain' : 'Ethereum')).join(' + ') || 'no readable leg'}
              {' · '}d = {m.offset}
            </span>
            <span className="fig">{p.chainStep === null ? 'n/a' : units(p.chainStep)}</span>
          </div>
        </>
      ) : null}
      {m.cmcDelta !== null && m.chainDelta !== null && m.coverageA !== null ? (
        <div className="proof-row">
          <span className="lbl">Window</span>
          <span>
            chain {units(m.chainDelta)} · CMC {units(m.cmcDelta)} · coverage {(m.coverageA * 100).toFixed(1)}% at the start
          </span>
          <span className="fig">{m.errPct === null ? '' : pct(m.errPct)}</span>
        </div>
      ) : null}
      <p className={`verdict-line${m.status === 'pass' ? ' pass' : ''}`}>
        Found: {m.status === 'pass' ? `within remedy (${m.errPct === null ? 'no move' : pct(m.errPct)} against ±10%)` : w.reason}
      </p>
      {w.mintReceipt ? (
        <p className="capture" style={{ margin: '6px 0 0' }}>
          A mint in that day’s step:{' '}
          <a className="data" href={w.mintReceipt.explorer_url} target="_blank" rel="noreferrer">
            {short(w.mintReceipt.tx, 8, 6)}
          </a>{' '}
          ({plain(w.mintReceipt.amount)} units, block <span className="data">{w.mintReceipt.block}</span>) → one recipient address{' '}
          <span className="data">{short(w.mintReceipt.recipient, 6, 5)}</span>. A mint can only be executed by the token’s minter.
        </p>
      ) : null}
    </div>
  );
}
