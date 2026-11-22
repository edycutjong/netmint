# Live lookups behind the demo video (2026-11-22)

Headless Chrome recorded the demo video by clicking the production site (https://netmint.edycu.dev, commit 28a2c36).
Each file is the `/api/lookup` response body the browser received during a take, verbatim:

| File | Take | Request | CMC calls · credits · ms | fetchedUtc |
|---|---|---|---|---|
| `seg05-NVDA-1.json` | "Run it live" on the hero, then the receipt drawer | `/api/lookup?u=NVDA&from=2026-10-22&to=2026-11-21` | 5 · 7 · 184 | 2026-11-22T00:56:05Z |
| `seg07-NVDA-1.json` | `/u/NVDA` pinned window (NVDAX NOT VERIFIABLE) | same query | 5 · 7 · 204 | 2026-11-22T01:04:45Z |
| `seg08-GOOGL-1.json` | `/u/GOOGL` pinned window (GOOGon REAL INFLOW, GOOGLB RECOUNT) | `/api/lookup?u=GOOGL&from=2026-10-22&to=2026-11-21` | 5 · 7 · 272 | 2026-11-22T01:04:19Z |

Verdicts and dollar figures match `evidence/2026-11-21/flows-30d.json` row for row (same pinned window). The hero card and
`/flows` scenes replay the committed 2026-11-21 captures, labelled as such on screen.

## On-screen figures → raw values

The app formats raw values (`lib/format.ts`: one decimal for $M, Unicode minus). Every figure the video shows, with its source:

| On screen | Raw value | Source |
|---|---|---|
| NVDAB REAL INFLOW +$202.8M · units ×7.13 · price −41.0% | net 202826522.82 · unitsX 7.1334 · pricePct −0.41045 | `seg05-NVDA-1.json`, `seg07-NVDA-1.json` (wrapper NVDAB `metrics`); `evidence/2026-11-21/flows-30d.json` |
| NVDAX "CMC Δ +$104.1M unproven" · coverage 14.5% · NOT VERIFIABLE | net 104095763.06 · coverageA 0.14476 | `seg07-NVDA-1.json` (wrapper NVDAX) |
| GOOGon REAL INFLOW +$6.0M · coverage 100.0% · chain vs CMC −0.5% | net 6034628.55 · coverageA 0.99950 · reason "chain +20,867 · CMC +20,967 · −0.5%" | `seg08-GOOGL-1.json` (wrapper GOOGon) |
| GOOGLB RECOUNT "CMC Δ +$62.3M unproven" · "2 of 5 step days outside" | net 62287838.29 · reason string | `seg08-GOOGL-1.json` (wrapper GOOGLB) |
| "live capture 2026-11-22 00:56 UTC · 7 credits charged · 184 ms" | fetchedUtc 2026-11-22T00:56:05.096Z · credits 7 · elapsedMs 184 | `seg05-NVDA-1.json` |
| Receipts: "5 CMC calls · 7 credits charged · 5 live chain reads"; quotes/historical "HTTP 200 · credit_count 3" | liveCmcCalls (5) · receipts r1–r10 | `seg05-NVDA-1.json` |
| /flows "20 underlyings, 152 wrappers · 129 CMC credits · 9 chain-verified moves"; 6 × "price down, units created" | 20 · 152 rows · credits 129 · 6 REAL_INFLOW + 3 OUTFLOW · 6 `price_down_money_in` | `evidence/2026-11-21/flows-30d.json` |
| Proof 1 +406,140 · Proof 2 +393,976 · 1-day step −3.0% · window chain +1,216,792 / CMC +1,209,739 · +0.6% | cmcStep 406140.41 · chainStep 393976.37 · errPct −0.02995 | `evidence/2026-11-21/nvda-30d/table.json` (NVDAB `proof`, `mint`) |
