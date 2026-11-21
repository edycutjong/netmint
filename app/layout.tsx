import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'NetMint',
  description: 'Net creation and redemption behind every tokenised stock, from CoinMarketCap supply history, checked against the chain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f6f3ec', color: '#1b1a17' }}>{children}</body>
    </html>
  );
}
