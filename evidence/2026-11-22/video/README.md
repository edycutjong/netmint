# Live lookups behind the demo video (2026-11-22)

Headless Chrome recorded the demo video by clicking the production site (https://netmint.edycu.dev, commit abe69a2).
Each file is the `/api/lookup` response body the browser received during a take, verbatim:

| File | Take | Request | CMC calls · credits | fetchedUtc |
|---|---|---|---|---|
| `seg05-NVDA-1.json` | "Run it live" on the hero, then the receipt drawer | `/api/lookup?u=NVDA&from=2026-10-22&to=2026-11-21` | 5 · 7 | 2026-11-22T00:30:49Z |
| `seg07-NVDA-1.json` | `/u/NVDA` pinned window (NVDAX NOT VERIFIABLE) | same query | 5 · 7 | 2026-11-22T00:29:07Z |
| `seg08-GOOGL-1.json` | `/u/GOOGL` pinned window (GOOGon REAL INFLOW, GOOGLB RECOUNT) | `/api/lookup?u=GOOGL&from=2026-10-22&to=2026-11-21` | 5 · 7 | 2026-11-22T00:28:02Z |

Verdicts and dollar figures match `evidence/2026-11-21/flows-30d.json` row for row (same pinned window). The hero card and
`/flows` scenes replay the committed 2026-11-21 captures, labelled as such on screen.
