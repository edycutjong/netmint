import { VERDICT_LABEL } from '@/lib/format';
import { SUBLINE } from '@/lib/flow/verdict';
import type { Verdict } from '@/lib/types';

/**
 * The hallmark cartouche: clipped-corner rectangle, double keyline, caps in Marcellus SC.
 * Ring colour carries verification (verdigris = passed trial; dashed graphite = unproven); never a pill.
 */
export function VerdictStamp({
  verdict,
  animate = false,
  height = 52,
  sub = false,
  delayMs = 0,
}: {
  verdict: Verdict;
  animate?: boolean;
  height?: number;
  sub?: boolean;
  delayMs?: number;
}) {
  const label = VERDICT_LABEL[verdict];
  const verified = verdict === 'REAL_INFLOW' || verdict === 'OUTFLOW';
  const ring = verified ? 'var(--after)' : 'var(--before)';
  const textInk = verdict === 'OUTFLOW' ? 'var(--debit)' : verified ? 'var(--after)' : 'var(--before)';
  const w = 36 + label.length * 15;
  const h = 52;
  const c = 8; // clipped corner
  const poly = (i: number) =>
    [
      [c + i, i],
      [w - c - i, i],
      [w - i, c + i],
      [w - i, h - c - i],
      [w - c - i, h - i],
      [c + i, h - i],
      [i, h - c - i],
      [i, c + i],
    ]
      .map((p) => p.join(','))
      .join(' ');
  const dash = verified ? undefined : '5 3';
  const aria = verified
    ? `Verdict: ${label} — verified on chain within remedy`
    : verdict === 'FLAT'
      ? 'Verdict: FLAT — below threshold, not put to trial'
      : `Verdict: ${label} — not verified on chain`;
  return (
    <span className={`stamp${animate ? ' strike' : ''}`} style={animate ? { animationDelay: `${delayMs}ms` } : undefined} role="img" aria-label={aria}>
      <svg viewBox={`-1 -1 ${w + 2} ${h + 2}`} height={height} width={(height * (w + 2)) / (h + 2)}>
        <polygon points={poly(0.75)} fill="none" stroke={ring} strokeWidth={1.5} strokeDasharray={dash} />
        <polygon points={poly(5)} fill="none" stroke={ring} strokeWidth={1} strokeDasharray={dash} />
        <text x={w / 2} y={h / 2 + 7} textAnchor="middle" fontSize={20} fill={textInk}>
          {label}
        </text>
      </svg>
      {sub ? <span className="sub">{SUBLINE[verdict]}</span> : null}
    </span>
  );
}
