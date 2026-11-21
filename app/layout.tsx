import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Albert_Sans, Chivo_Mono, Marcellus_SC } from 'next/font/google';
import './globals.css';

const marcellus = Marcellus_SC({ weight: '400', subsets: ['latin'], variable: '--f-marcellus', display: 'swap' });
const albert = Albert_Sans({ subsets: ['latin'], variable: '--f-albert', display: 'swap' });
const chivo = Chivo_Mono({ subsets: ['latin'], variable: '--f-chivo', display: 'swap' });

const TITLE = 'NetMint: the money behind every tokenised stock, checked against the chain';
const DESCRIPTION =
  'CMC lists each tokenised stock’s supply, not the dollars created or redeemed behind it. NetMint shows them, checked against the chain.';
const OG_ALT =
  'NetMint: NVDAB supply rose ×7.1 while the price fell 41% (22 Oct to 21 Nov 2026); the chain confirms the supply steps within remedy, struck REAL INFLOW beside +$202.83M net creation at market price.';

export const metadata: Metadata = {
  metadataBase: new URL('https://netmint.edycu.dev'),
  authors: [{ name: 'Edy Cu' }],
  creator: 'Edy Cu',
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
  openGraph: {
    type: 'website',
    siteName: 'NetMint',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/og-image.png', width: 2400, height: 1260, alt: OG_ALT }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: '/og-image.png', alt: OG_ALT }] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${marcellus.variable} ${albert.variable} ${chivo.variable}`}>
      <body>
        <header className="masthead">
          <Link className="mark" href="/">
            NetMint
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/">Hero</Link>
            <Link href="/flows">Flows</Link>
            <a href="/about">About</a>
            <a href="/pitch">Pitch</a>
          </nav>
          <span className="tag">
            A supply jump can be new tokens or a data change. NetMint shows which, and the dollars behind it, checked on chain.
          </span>
        </header>
        {children}
        <footer className="foot">
          Data: CoinMarketCap API (<span className="data">/v5/real-world-assets/assets/list</span>,{' '}
          <span className="data">/v5/real-world-assets/quotes/latest</span>,{' '}
          <span className="data">/v2/cryptocurrency/quotes/historical</span>, <span className="data">/v2/cryptocurrency/info</span>,{' '}
          <span className="data">/v2/cryptocurrency/quotes/latest</span>) and BNB Chain / Ethereum archive RPC. Dollar figures are at the
          wrapper’s market price. Not investment advice. · <a href="/api/health">service status</a>
        </footer>
      </body>
    </html>
  );
}
