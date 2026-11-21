import { HeroCard } from './components/HeroCard';
import type { LookupError } from './components/ErrorBanner';
import { lookup, LookupFailure } from '@/lib/lookup';
import type { LookupResult } from '@/lib/types';

// ISR: the hero is a real lookup, re-captured at most hourly; "Run it live" re-runs it on click.
export const revalidate = 3600;

const HERO_U = 'NVDA';
const RAIL = ['NVDA', 'GOOGL', 'INTC', 'SPCX', 'MSTR', 'SNDK', 'MU', 'SKHY', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'COIN', 'HOOD', 'CRCL'];

async function capture(): Promise<{ res: LookupResult | null; err: LookupError | null }> {
  try {
    return { res: await lookup(HERO_U, { window: 30 }), err: null };
  } catch (e) {
    const at = new Date().toISOString();
    if (e instanceof LookupFailure) return { res: null, err: { status: e.httpStatus, error: e.message, at, ...(e.extra as object) } };
    return { res: null, err: { status: 500, error: (e as Error).message, at } };
  }
}

export default async function Home() {
  const { res, err } = await capture();
  return (
    <main className="page">
      <div className="grid-hero">
        <HeroCard initial={res} initialError={err ? { ...err, ...({ receipts: undefined } as object) } : null} u={HERO_U} />
        <aside className="rail">
          <h2>Underlyings</h2>
          <form className="search" action="/u" method="get">
            <label htmlFor="t" className="muted" style={{ position: 'absolute', left: -9999 }}>
              Ticker
            </label>
            <input id="t" name="t" placeholder="Ticker, e.g. NVDA" autoComplete="off" maxLength={12} />
            <button className="btn" type="submit">
              Look up
            </button>
          </form>
          <ul className="tickers">
            {RAIL.map((t) => (
              <li key={t}>
                <a href={`/u/${t}`}>{t}</a>
              </li>
            ))}
          </ul>
          <h2>How a verdict is reached</h2>
          <p className="muted" style={{ fontSize: 15, marginTop: 0 }}>
            CMC’s daily supply history gives the units created or redeemed each day; times the wrapper’s price, that is net creation in dollars.
            Each supply move is then put on trial against the token’s on-chain <span className="data">totalSupply</span>, summed over BNB Chain and
            Ethereum at day-boundary blocks, within a remedy of ±10%. Only a move the chain confirms is stamped REAL INFLOW or OUTFLOW.
          </p>
        </aside>
      </div>
    </main>
  );
}
