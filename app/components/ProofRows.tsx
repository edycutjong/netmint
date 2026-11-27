import { pct, plain, short, units } from '@/lib/format';
import { interiorHoles } from '@/lib/flow/sanity';
import type { WrapperResult } from '@/lib/types';

/** The two proving rows beside every verdict: CMC's step vs the chain's step, then the jury's verdict line. */
export function ProofRows({ w }: { w: WrapperResult }) {
  const p = w.proof;
  const m = w.mint;
  if (!m) return null;
  // the rows above show a 1-day step; the trial that decided the verdict used the sum around that day (lib/flow/mintCheck.ts)
  const trial = p ? m.stepDays.find((s) => s.date === p.date) : undefined;
  const field = m.comparator === 'total_supply' ? 'total supply' : 'circulating supply';
  const recount = w.verdict === 'RECOUNT';
  // days inside a verified window with no accepted CMC point, read from the payload (the "Found" line below trims the same
  // disclosure out of the reason string, so it must not be the only place that carries it)
  const holes = w.verdict === 'REAL_INFLOW' || w.verdict === 'OUTFLOW' ? interiorHoles(w.series, w.refused) : { gaps: [], refusedDays: [] };
  const holeCount = holes.gaps.length + holes.refusedDays.length;
  // "chain-verified" here is what the mint check covers: the window's endpoints and its largest step days, not every day
  const holeLine = holeCount
    ? `Inside the window ${[
        holes.gaps.length ? `CMC sent no row for ${holes.gaps.join(', ')}` : '',
        holes.refusedDays.length ? `the sanity guard refused ${holes.refusedDays.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(
          ' and ',
        )}: the window’s supply move is chain-verified at its endpoints and largest step days, and the dollars across ${holeCount > 1 ? 'those days' : 'that day'} use the neighbouring days’ average price.`
    : null;
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
          {trial ? (
            <p className="verdict-line" style={{ margin: '4px 0 0' }}>
              The trial used the sum over {trial.span ? `${trial.span[0]} → ${trial.span[1]}` : 'up to 3 days around it'}: CMC{' '}
              {units(trial.cmc3d)} · chain {trial.chain3d === null ? 'not read' : units(trial.chain3d)}
              {trial.chain3d === null ? '' : trial.ok ? ' · within tolerance' : ' · outside tolerance'}
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
          ? `window and material steps verified: ${w.reason.split(/ · \d+ (?:missing CMC days?|CMC days?) inside the window/)[0].replace(/^window endpoints and the largest step days \(up to 5\) verified \((.*)\)$/, '$1')}`
          : w.reason}
      </p>
      {holeLine ? (
        <p className="verdict-line" style={{ margin: '4px 0 0' }}>
          {holeLine}
        </p>
      ) : null}
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
          <span className="data">{short(w.mintReceipt.recipient, 6, 5)}</span>: a Transfer from the zero address, one sample, not the whole
          step.
        </p>
      ) : null}
    </div>
  );
}
