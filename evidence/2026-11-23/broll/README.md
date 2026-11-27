# Live lookup behind the README GIF (2026-11-23)

Headless Chrome opened <https://netmint.edycu.dev/judge> and clicked its "Open the NVDAB 30-day lookup" link
(`target=_blank`); the new tab, `/u/NVDA?from=2026-10-22&to=2026-11-21`, called `/api/lookup` on load. The JSON file here holds
that response body under `response`, verbatim as the browser received it, beside the request path, the HTTP status and the receive time. It backs every live value shown in
[`docs/assets/netmint-broll.gif`](../../../docs/assets/netmint-broll.gif): the capture line, the receipt drawer and its JSON.

| File | Request | mode | CMC calls · credits · server ms | chain reads | fetchedUtc |
|---|---|---|---|---|---|
| `lookup-NVDA-pinned-2026-11-23T1351.json` | `/api/lookup?u=NVDA&from=2026-10-22&to=2026-11-21` | live (not cached) | 5 · 7 · 211 | 5 `eth_call` | 2026-11-23T13:51:25.289Z |

Timing in the GIF is this run's measured wall clock, untrimmed: the new tab loaded 331 ms after the click and the response
arrived 1,282 ms after it. The page's own CSS animations play at their real duration. The cursor, click rings, row outlines and
caption bar are overlays added to the GIF. Net creation per wrapper equals `evidence/2026-11-21/nvda-30d/table.json`
(`net_usd` NVDAB 202826522.82 REAL INFLOW; NVDAX 104095763.06 NOT VERIFIABLE), the same pinned window.
