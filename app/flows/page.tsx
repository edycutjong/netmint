import { VerdictStamp } from '../components/VerdictStamp';
import { CopyTable } from '../components/CopyTable';
import Link from 'next/link';
import { loadFlows, type FlowRow } from '@/lib/flows';
import { pct, times, usd, utcStamp, VERDICT_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: '/flows: net creation and redemption across tokenised stocks · NetMint' };

const isVerified = (r: FlowRow) => r.verdict === 'REAL_INFLOW' || r.verdict === 'OUTFLOW';
const DIV_LABEL = { price_down_money_in: 'price down, units created', price_up_money_out: 'price up, units redeemed' } as const;

function tsv(rows: FlowRow[], head: string): string {
  const cols = [
    'verdict',
    'wrapper',
    'issuer',
    'underlying',
    'net_creation_usd_verified_only',
    'cmc_supply_change_usd_unverified',
    'units_x',
    'price_pct',
    'divergence',
    'coverage',
  ];
  const body = rows.map((r) =>
    [
      r.verdict ? VERDICT_LABEL[r.verdict] : 'NO VERDICT',
      r.symbol,
      r.issuer,
      r.underlying,
      isVerified(r) && r.netUsd !== null ? Math.round(r.netUsd) : '',
      !isVerified(r) && r.netUsd !== null ? Math.round(r.netUsd) : '',
      r.unitsX === null ? '' : r.unitsX.toFixed(3),
      r.pricePct === null ? '' : (r.pricePct * 100).toFixed(1) + '%',
      r.divergence ? DIV_LABEL[r.divergence] : '',
      r.coverage === null ? '' : (r.coverage * 100).toFixed(1) + '%',
    ].join('\t'),
  );
  return [head, cols.join('\t'), ...body].join('\n');
}

export default async function Flows({ searchParams }: { searchParams: Promise<{ w?: string; all?: string }> }) {
  const sp = await searchParams;
  const w = sp.w === '7' ? 7 : 30;
  const all = sp.all === '1';
  const t = loadFlows(w);
  return (
    <main className="page">
      <p className="eyebrow">Across the tokenised-stock universe</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 40, margin: '0 0 12px', letterSpacing: '0.04em' }}>
        Flows
      </h1>
      <div className="actions" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="seg" role="group" aria-label="Window">
          <a href={`/flows?w=7${all ? '&all=1' : ''}`} className="segl" aria-current={w === 7 ? 'true' : undefined}>
            7 d
          </a>
          <a href={`/flows?w=30${all ? '&all=1' : ''}`} className="segl" aria-current={w === 30 ? 'true' : undefined}>
            30 d
          </a>
        </div>
        <a
          className="btn quiet"
          href={all ? `/flows?w=${w}` : `/flows?w=${w}&all=1`}
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          {all ? 'Show only rows with a verdict' : 'Show all wrappers (incl. not verifiable)'}
        </a>
      </div>
      {!t ? (
        <div className="banner" role="alert">
          No captured flows table for {w} d is deployed, and nothing is invented in its place. Try the other window, or{' '}
          <Link href="/">open a ticker</Link> to run a live lookup.
        </div>
      ) : (
        <FlowsBody t={t} all={all} />
      )}
    </main>
  );
}

function FlowsBody({ t, all }: { t: NonNullable<ReturnType<typeof loadFlows>>; all: boolean }) {
  const verified = t.rows.filter((r) => r.verdict === 'REAL_INFLOW' || r.verdict === 'OUTFLOW');
  const div = t.rows.filter((r) => r.divergence);
  const shown = all ? t.rows : t.rows.filter((r) => r.verdict && r.verdict !== 'NOT_VERIFIABLE');
  const head = `NetMint /flows ${t.window} d, ${t.range.from} to ${t.range.to} UTC, captured ${utcStamp(t.generatedUtc)}, ${t.universe.underlyings} underlyings / ${t.rows.length} wrappers (${t.universe.ranking}); net creation = units created or redeemed x price at the wrapper's market price`;
  return (
    <>
      <p className="capture">
        {t.range.from} → {t.range.to} UTC · captured {utcStamp(t.generatedUtc)} · {t.universe.underlyings} underlyings, {t.rows.length}{' '}
        wrappers (top by CMC tokenised market cap) · {t.credits} CMC credits for the capture · <strong>{verified.length}</strong>{' '}
        chain-verified moves, <strong>{div.length}</strong> where price and net creation disagree
      </p>
      <p className="note">
        A table captured at the time above, not a live feed: every row came from the same lookup a click runs, with its CMC bodies
        committed. Open an underlying to re-run it live with receipts.
        {t.skipped.length ? ` Not computed this capture: ${t.skipped.map((s) => s.underlying).join(', ')}.` : ''}
      </p>
      <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
        <CopyTable text={tsv(shown, head)} />
      </div>
      <div className="wrap-x">
        <table className="ledger flows" aria-label="Net creation per tokenised wrapper">
          <thead>
            <tr>
              <th scope="col">Verdict</th>
              <th scope="col">Wrapper</th>
              <th scope="col">Net creation</th>
              <th scope="col">Units ×</th>
              <th scope="col">Price</th>
              <th scope="col" className="hide-sm">
                Price vs money
              </th>
              <th scope="col" className="hide-sm">
                Chain coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.cryptoId}>
                <td>{r.verdict ? <VerdictStamp verdict={r.verdict} height={26} /> : <span className="muted">no verdict</span>}</td>
                <td>
                  <strong className="data">{r.symbol}</strong> <span className="muted">· {r.issuer}</span>
                  <div className="reason">
                    <a
                      href={`/u/${encodeURIComponent(r.underlying)}?from=${t.range.from}&to=${t.range.to}`}
                      aria-label={`Open ${r.underlying} live, same window (row ${r.symbol})`}
                    >
                      Open {r.underlying} live, same window
                    </a>
                  </div>
                </td>
                <td
                  className={`num money ${r.netUsd !== null && r.netUsd < 0 && isVerified(r) ? 'debit' : ''}`}
                  title={
                    isVerified(r)
                      ? 'Net creation, verified on chain'
                      : 'CMC supply change × price; the chain does not confirm it, so it is not net creation'
                  }
                >
                  {r.netUsd === null ? (
                    ''
                  ) : isVerified(r) ? (
                    usd(r.netUsd)
                  ) : (
                    <span className="muted">CMC supply Δ {usd(r.netUsd)}, unproven</span>
                  )}
                </td>
                <td className={`num ${isVerified(r) ? '' : 'muted'}`}>{r.unitsX === null ? '' : times(r.unitsX)}</td>
                <td className={`num ${r.pricePct !== null && r.pricePct < 0 ? 'debit' : ''}`}>
                  {r.pricePct === null ? '' : pct(r.pricePct)}
                </td>
                <td className="hide-sm">
                  {r.divergence ? <span className="tag-div">{DIV_LABEL[r.divergence]}</span> : <span className="muted">—</span>}
                </td>
                <td className="num hide-sm">{r.coverage === null ? '—' : `${(r.coverage * 100).toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="definition">
        Counted the way ETF flow tables count creations: units created or redeemed × price. REAL INFLOW and OUTFLOW are issuer-level net
        creation and redemption that the chain confirms within ±10% of the move (or 0.5% of supply for small moves), not buyer data; “price
        vs money” marks only those. RECOUNT means CMC’s supply step and the summed chains’ step disagree beyond tolerance; NOT VERIFIABLE
        means the move may sit on a chain NetMint does not read, or the check cannot certify it (
        {t.rows.filter((r) => r.verdict === 'NOT_VERIFIABLE').length} of {t.rows.length}; {t.rows.length - shown.length} of {t.rows.length}{' '}
        rows are hidden in this view). Chain coverage is the on-chain supply summed over BNB Chain and Ethereum ÷ CMC’s supply at the window
        start; a little over 100% means the chain read higher. On RECOUNT and NOT VERIFIABLE rows the dollar figure is CMC’s supply change ×
        price and is shown only as unproven. Evidence: <span className="data">evidence/{t.generatedUtc.slice(0, 10)}/flows/</span>.
      </p>
    </>
  );
}
