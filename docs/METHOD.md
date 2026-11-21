# Method

1. Pull daily `circulating_supply`, `total_supply` and `price` per wrapper (`/v2/cryptocurrency/quotes/historical`, USD).
2. Net creation = Δ`circulating_supply` × price (the mean of the two days' prices) summed over the window; a sanity guard drops artefact
   rows before any maths.
3. Mint check: the CMC move must match the on-chain `totalSupply` step within ±10% (`lib/flow/params.ts`) at the window ends
   (tolerance: ±10% of the move or 0.5% of supply, whichever is larger; coverage 90-110%) and on the largest step days (3-day sums)
   until they carry 80% of gross flow or five days, whichever comes first; one day offset is fixed per issuer (`data/offsets.json`).
   The trial compares CMC `total_supply` with the chain (`circulating_supply` when CMC omits total on any day); a guard requires the
   circulating and total moves to agree within the same tolerance, else NOT VERIFIABLE.
4. Verdict by fixed code (`lib/flow/verdict.ts`): REAL INFLOW / OUTFLOW need a passing mint check. RECOUNT = CMC's step and
   the summed chains' step disagree beyond tolerance where the chains cover the supply; NOT VERIFIABLE = the move may sit on a chain NetMint
   does not read, or the check cannot certify it; FLAT = net under the larger of $250K and 2% of market cap, not tried. Calibration data: `docs/proof/calibration/`.
