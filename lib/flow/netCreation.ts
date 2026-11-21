/**
 * Net creation (complexity §4.2), counted the way ETF flow tables count creations: units created or redeemed × price.
 * flow_t = ΔS_t × (P_{t−1} + P_t) / 2 over consecutive accepted points (circulating supply, wrapper market price).
 */
import type { DailyPoint, FlowMetrics } from '../types';

export function netCreation(series: DailyPoint[]): FlowMetrics | null {
  if (series.length < 2) return null;
  const flows: FlowMetrics['flows'] = [];
  let net = 0,
    grossIn = 0,
    grossOut = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1],
      b = series[i];
    const deltaS = b.supply - a.supply;
    const flow = deltaS * ((a.price + b.price) / 2);
    flows.push({ date: b.date, deltaS, flow });
    net += flow;
    if (flow > 0) grossIn += flow;
    else grossOut += flow;
  }
  const A = series[0],
    B = series[series.length - 1];
  return {
    net,
    grossIn,
    grossOut,
    unitsX: B.supply / A.supply,
    pricePct: B.price / A.price - 1,
    supplyA: A.supply,
    supplyB: B.supply,
    priceA: A.price,
    priceB: B.price,
    supplyDelta: B.supply - A.supply,
    marketCapA: A.marketCap,
    flows,
  };
}

/** Quoted-vs-flow divergence: money in while the price fell, or money out while it rose. */
export function diverges(m: FlowMetrics, thresholdUsd: number): boolean {
  return Math.sign(m.net) !== Math.sign(m.pricePct) && Math.abs(m.net) >= thresholdUsd && m.pricePct !== 0;
}
