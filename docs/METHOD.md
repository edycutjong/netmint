# Method

1. Pull daily `circulating_supply`, `total_supply` and `price` per wrapper (`/v2/cryptocurrency/quotes/historical`, USD).
2. Net creation = Δsupply × price over the window; a sanity guard drops artefact rows before any maths.
3. Mint check: the CMC move must match the on-chain `totalSupply` step within ±10% (`lib/flow/params.ts`) at the window ends
   (tolerance: ±10% of the move or 0.5% of supply, whichever is larger; coverage 90-110%) and on the largest step days (3-day sums)
   until they carry 80% of gross flow or five days, whichever comes first; one day offset is fixed per issuer.
4. Verdict by fixed code (`lib/flow/verdict.ts`): REAL INFLOW / OUTFLOW need a passing mint check; otherwise RECOUNT,
   NOT VERIFIABLE or FLAT. Calibration data: `docs/proof/calibration/`.
