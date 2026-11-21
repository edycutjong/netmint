/** Core types shared by the lookup flow, the API route, the pages and the scripts. */
import type { ChainId } from './chain/rpc';

/** One accepted CMC daily point (00:00 UTC). `supply` = circulating_supply. */
export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  supply: number;
  totalSupply: number | null; // null when CMC sends null or <= 0
  price: number;
  volume24h: number;
  marketCap: number;
}

export type RefusedReason =
  | 'price_missing'
  | 'price_nonpositive'
  | 'supply_missing'
  | 'magnitude'
  | 'duplicate'
  | 'gap'
  | 'spike_revert';

export interface RefusedRow {
  date: string;
  reason: RefusedReason;
  detail: string;
  raw: unknown;
}

/** Raw CMC daily row as parsed from quotes/historical (before the sanity guard). */
export interface RawDailyRow {
  timestamp: string;
  price: number | null | undefined;
  circulating_supply: number | null | undefined;
  total_supply: number | null | undefined;
  volume_24h: number | null | undefined;
  market_cap: number | null | undefined;
}

export type Verdict = 'REAL_INFLOW' | 'OUTFLOW' | 'RECOUNT' | 'NOT_VERIFIABLE' | 'FLAT';

export interface ChainLeg {
  chain: ChainId;
  address: string;
  decimals: number | null;
  supplyA: number | null;
  supplyB: number | null;
  blocks: [number | null, number | null];
  source: 'baseline' | 'live' | 'mixed' | 'none';
}

export interface StepDay {
  date: string;
  cmc3d: number;
  chain3d: number | null;
  ok: boolean;
}

export interface MintCheck {
  status: 'pass' | 'fail' | 'impossible' | 'ambiguous';
  comparator: 'total_supply' | 'circulating_supply';
  coverageA: number | null;
  coverageB: number | null;
  outsideSupplyA: number | null;
  unreadableLeg: boolean;
  unreadableChains: string[];
  tolerance: number | null;
  offset: -1 | 0 | 1;
  offsetSource: 'issuer' | 'default';
  altOffsetPasses: boolean;
  altOffset: -1 | 0 | 1 | null;
  windowOk: boolean;
  stepOk: boolean;
  directionOk: boolean;
  guardOk: boolean;
  cmcDelta: number | null; // ΔcmcTot over [A, B]
  chainDelta: number | null; // ΔchainS over [A+d, B+d]
  errPct: number | null; // (chainDelta − cmcDelta) / |cmcDelta|
  remedy: number;
  chainSource: 'baseline' | 'live' | 'mixed' | 'none';
  chainDates: [string, string] | null;
  legs: ChainLeg[];
  stepDays: StepDay[];
  reason: string;
}

export interface FlowMetrics {
  net: number;
  grossIn: number;
  grossOut: number;
  unitsX: number;
  pricePct: number;
  supplyA: number;
  supplyB: number;
  priceA: number;
  priceB: number;
  supplyDelta: number; // ΔcmcCirc
  marketCapA: number;
  flows: { date: string; deltaS: number; flow: number }[];
}

export interface MintReceipt {
  crypto_id: number;
  symbol: string;
  chain: ChainId;
  date: string;
  tx: string;
  block: number;
  amount: number;
  recipient: string;
  explorer_url: string;
}

export interface WrapperResult {
  cryptoId: number;
  symbol: string;
  name: string;
  issuer: string;
  chains: string[];
  derivative: boolean;
  marketCap: number | null;
  exitRatio: number | null; // 24h volume ÷ market cap (today, quotes/latest)
  metrics: FlowMetrics | null;
  series: DailyPoint[];
  refused: RefusedRow[];
  mint: MintCheck | null;
  verdict: Verdict | null; // null = no verdict (error or < 2 points)
  reason: string;
  error?: string;
  mintReceipt?: MintReceipt;
  today?: { price: number | null; supply: number | null; volume24h: number | null; capturedUtc: string };
}

export interface Receipt {
  id: string;
  kind: 'cmc' | 'rpc';
  endpoint: string;
  params: Record<string, string>;
  startedUtc: string;
  elapsedMs: number;
  httpStatus: number;
  creditCount?: number;
  errorCode?: number;
  errorMessage?: string | null;
  body?: unknown;
  bodyBytes: number;
  curl?: string;
  explorerUrl?: string;
  chain?: ChainId;
  block?: number;
}

export type LookupWindow = 7 | 30 | 90;

export interface LookupResult {
  underlying: { rwaId: number; ticker: string; name: string };
  window: LookupWindow | null;
  range: { from: string; to: string; pinned: boolean };
  fetchedUtc: string;
  mode: 'live' | 'live-stored' | 'cached' | 'recorded';
  live: boolean;
  cacheHit: boolean;
  wrappers: WrapperResult[];
  receipts: Receipt[];
  credits: number;
  elapsedMs: number;
  errors: { source: string; message: string }[];
  cmcError?: { code: number; message: string; endpoint: string; httpStatus: number };
}
