export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>NetMint</h1>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>
        CoinMarketCap records every tokenised stock&apos;s circulating supply every day. NetMint turns that history into net
        creation and redemption per wrapper, and checks each move against the chain.
      </p>
      <p style={{ fontSize: 14, opacity: 0.7 }}>
        Work in progress. Service status: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
