# NetMint: demo and reproduce

All figures: NVDAB (bStocks), 2026-10-22 → 2026-11-21, captured 2026-11-21 (a market stress window). Raw bodies:
[`evidence/2026-11-21/nvda-30d/`](evidence/2026-11-21/nvda-30d/).

## Click path on the live app

1. Open <https://netmint.edycu.dev>. The hero shows NVDAB: **REAL INFLOW +$202.83M**, with the two proving rows beside it (CMC supply on
   the first and last day, and the on-chain step with its mint transaction).
2. Open `/u/NVDA` and run it. The page calls `/api/lookup?u=NVDA&window=30`; the receipt drawer lists every CMC call verbatim
   (endpoint, params, status, body) and the credit count.
3. Open `/flows` for the top 20 tokenised stocks (152 wrappers). Switch 7 d / 30 d; the default view lists only rows with a verdict; "Show all wrappers" adds the not-verifiable ones.
4. Open [`/api/health`](https://netmint.edycu.dev/api/health) for capture time, CMC plan state and RPC status (the key is never shown).

## Reproduce from the repo

```bash
npm ci
export CMC_API_KEY=...
npm run demo -- NVDA          # 5 CMC calls, 7 credits, ~2 s, 0 RPC reads (uses the committed chain baseline)
npm test                      # 201 passing
npm run verify:offline        # network blocked: exits non-zero, prints no verdict
npm run verify:flows          # 304 stored leaderboard rows re-derived, 0 diffs
```

Expected output (excerpt) of the demo (live CMC, so figures drift with the market; the stored copy is in
`evidence/2026-11-21/nvda-30d/table.json`):

```text
NetMint · Nvidia Corp (NVDA, rwa_id 2) · 2026-10-22 → 2026-11-21 (30 d)
REAL INFLOW     NVDAB    bStocks           +$202.83M units ×7.13  price −41.0%   cov 96.1%
NOT VERIFIABLE  NVDAX    Backed Assets     +$104.10M (`net_usd` 104095763.06) units ×3.98  price −41.0%   cov 14.5%
```

## What the proof rows say

| Check | CMC | Chain | Result |
|---|---|---|---|
| Window supply change | +1,209,739 | +1,216,792 | +0.6%, within ±10% |
| Step 2026-11-13 (3 d) | 522,505 | 535,910 | ok |
| Step 2026-11-18 (3 d) | 400,526 | 409,071 | ok |
| Step 2026-11-17 (3 d) | 386,252 | 372,839 | ok |
| Step 2026-11-10 (3 d) | 294,447 | 281,930 | ok |
| Step 2026-11-11 (3 d) | 430,435 | 443,621 | ok |

Sampled mint for the 2026-11-13 step (block 133,127,844, 2026-11-12 08:25 UTC, 640 units, 0.16% of that day's step; all 7 sampled mints went to this recipient): `0xa239f8886f2b7a4a61daa2787b0b53e58715c2c0dcd8d8f4ef84c8dfea15266c` → `0x5948602680fe4aea08d98302337a2715b3aadad1`.

## Limits

Wrappers whose supply sits on Solana, Arbitrum, Base, Robinhood Chain or X Layer return NOT VERIFIABLE (for example NVDAX: 86% of
supply on Solana). Dollar figures are net creation at market price, not buyer data and not advice. After the event key reverts to Basic
(9 Dec 23:59 UTC) lookups run as `live-stored`: stored dated CMC bodies plus live chain reads, labelled in the receipts.
