import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Albert_Sans, Chivo_Mono, Marcellus_SC } from 'next/font/google';
import './globals.css';

const marcellus = Marcellus_SC({ weight: '400', subsets: ['latin'], variable: '--f-marcellus', display: 'swap' });
const albert = Albert_Sans({ subsets: ['latin'], variable: '--f-albert', display: 'swap' });
const chivo = Chivo_Mono({ subsets: ['latin'], variable: '--f-chivo', display: 'swap' });

export const metadata: Metadata = {
  title: 'NetMint: the money behind every tokenised stock, checked against the chain',
  description:
    'CoinMarketCap records every tokenised stock’s supply every day but never shows the money behind it. NetMint turns that history into net creation and redemption per wrapper and puts each supply move on trial against the chain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${marcellus.variable} ${albert.variable} ${chivo.variable}`}>
      <body>
        <header className="masthead">
          <a className="mark" href="/">
            NetMint
          </a>
          <nav className="nav" aria-label="Main">
            <a href="/">Hero</a>
            <a href="/flows">Flows</a>
          </nav>
          <span className="tag">CMC records every tokenised stock’s supply. We show the money behind it, checked on chain.</span>
        </header>
        {children}
        <footer className="foot">
          Data: CoinMarketCap API (<span className="data">/v5/real-world-assets/assets/list</span>,{' '}
          <span className="data">/v5/real-world-assets/quotes/latest</span>, <span className="data">/v2/cryptocurrency/quotes/historical</span>,{' '}
          <span className="data">/v2/cryptocurrency/info</span>, <span className="data">/v2/cryptocurrency/quotes/latest</span>) and BNB Chain /
          Ethereum archive RPC. Dollar figures are at the wrapper’s market price. Not investment advice. ·{' '}
          <a href="/api/health">service status</a>
        </footer>
      </body>
    </html>
  );
}
