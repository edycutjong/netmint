# Contributing to NetMint

Thanks for looking. NetMint turns CoinMarketCap's recorded supply history for tokenised stocks into net creation/redemption and a
verdict per wrapper, checked against the chain. Small, evidence-backed changes are the easiest to merge.

## Getting started

```bash
npm ci
cp .env.example .env.local        # CMC_API_KEY (and ALCHEMY_API_KEY for chain reads) — server-side only, never committed
npm run dev                       # http://localhost:3000
```

## Before you open a PR

```bash
npm run ci          # audit + prettier + eslint + tsc + vitest with a coverage floor
npm run build
npm run verify:flows    # re-derives every committed leaderboard row from its stored CMC bodies: 0 differences expected
npm run verify:offline  # with the network unplugged the demo must FAIL and print no verdict
npm run e2e         # Playwright against the live URL (E2E_BASE_URL overrides it)
```

## Ground rules

- **No figure without a receipt.** A number in the README, a page or a test must come from `evidence/` or `docs/proof/`, or from a
  measured run whose raw rows are committed. Date it.
- **The judged path is never mocked.** Recorded fixtures exist for tests and are labelled as recorded; the default path calls
  CoinMarketCap and the chain.
- **A supply change is not called an inflow** until the mint check passes for that asset; otherwise the verdict is RECOUNT or NOT VERIFIABLE.
- No investment-advice wording.
- Secrets never enter the tree. `gitleaks detect` runs in CI over the full history.
- Conventional, small commits with a real message.

## Reporting bugs and requesting features

Use the issue templates. For a wrong verdict, include the ticker, the window, and the `/api/lookup` response (receipts included).
For anything security-related, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
