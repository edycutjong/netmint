/**
 * Every threshold the verdict uses, in one place. These are design choices (complexity §4.1/§4.3), calibrated on the
 * NVDA family only in P1b (scripts/calibrate.ts → docs/proof/calibration/), frozen in docs/METHOD.md before the
 * held-out score. Changing one changes verdicts, so tests pin them.
 */
export const PARAMS = {
  coverageMin: 0.9,
  coverageMax: 1.1,
  remedy: 0.1, // ±10% window + step tolerance
  floorFrac: 0.005, // tolerance floor: 0.5% of CMC supply at B
  directionRatio: 0.75, // |Δchain| ≥ 0.75 × |ΔCMC| for a directional verdict
  outsideRatio: 0.25, // u ≥ 0.25 × |ΔCMC| → the move may sit on an unread chain
  stepCarry: 0.8, // material step days carry ≥ 80% of gross |flow|
  maxStepDays: 5,
  flatUsd: 250_000, // FLAT below max($250k, 2% of market cap at A)
  flatCapFrac: 0.02,
  // sanity guard
  maxPrice: 1e7,
  maxSupply: 1e13,
  spikeMinFrac: 0.25, // a spike is a step ≥ 25% of the prior supply …
  spikeRevertFrac: 0.9, // … that reverts by ≥ 90% of itself within 1 day
} as const;

export type Offset = -1 | 0 | 1;
