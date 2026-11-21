/**
 * Read-only EVM JSON-RPC over Alchemy (archive). NetMint never sends a transaction.
 * The Alchemy key sits in the URL path, so URLs are built here and never logged:
 * receipts record `chain` + method + params + block, not the URL.
 */
export type ChainId = 'bsc' | 'eth';

const ALCHEMY_NETWORK: Record<ChainId, string> = { bsc: 'bnb-mainnet', eth: 'eth-mainnet' };

export const EXPLORER: Record<ChainId, string> = { bsc: 'https://bscscan.com', eth: 'https://etherscan.io' };

/** CMC `platform.name` / `contract_address[].platform.name` → our chain id. */
export function chainFromPlatform(name: string | undefined | null): ChainId | null {
  const n = (name ?? '').toLowerCase();
  if (n === 'ethereum') return 'eth';
  if (n === 'bnb smart chain (bep20)' || n === 'bnb smart chain' || n === 'bsc' || n === 'bnb chain') return 'bsc';
  return null;
}

function rpcUrl(chain: ChainId, apiKey = process.env.ALCHEMY_API_KEY): string {
  if (!apiKey) throw new Error('ALCHEMY_API_KEY is not set');
  return `https://${ALCHEMY_NETWORK[chain]}.g.alchemy.com/v2/${apiKey}`;
}

export interface RpcReq {
  method: string;
  params: unknown[];
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** Request-path budget (the lookup route has maxDuration 60 s): 8 s per attempt, 3 retries, backoff ≤ 0.5 + 1 + 2 s, so
 * one batch is ≤ ~36 s worst case; the lookup also stops all chain reads at a 40 s deadline (lib/chain/supply.ts).
 * Capture scripts pass the long budget explicitly. */
export const RPC_REQUEST = { timeoutMs: 8_000, maxRetries: 3, maxBackoffMs: 2_000 } as const;
export const RPC_SCRIPT = { timeoutMs: 30_000, maxRetries: 8, maxBackoffMs: 8_000 } as const;

/** One JSON-RPC batch; returns results in request order. Throws if any entry errors. */
export async function rpcBatch<T = string>(
  chain: ChainId,
  reqs: RpcReq[],
  budget: { timeoutMs: number; maxRetries: number; maxBackoffMs?: number; deadline?: number } = RPC_REQUEST,
): Promise<T[]> {
  const { timeoutMs, maxRetries: MAX_RETRIES } = budget;
  if (reqs.length === 0) return [];
  const backoff = (a: number) =>
    new Promise((r) => setTimeout(r, Math.min(500 * 2 ** a, budget.maxBackoffMs ?? 4_000) + Math.random() * 250));
  type Entry = { id: number; result?: T; error?: { code: number; message: string } };
  const done = new Map<number, Entry>();
  let pending = reqs.map((_, i) => i);
  const left = () => (budget.deadline === undefined ? Infinity : budget.deadline - Date.now());
  for (let attempt = 0; ; attempt++) {
    if (left() <= 0) throw new RpcError(`${chain} chain-read time budget exhausted`);
    const payload = pending.map((i) => ({ jsonrpc: '2.0', id: i, method: reqs[i].method, params: reqs[i].params }));
    const res = await fetch(rpcUrl(chain), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, left()))),
      cache: 'no-store',
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await backoff(attempt);
      continue;
    }
    if (!res.ok) throw new RpcError(`${chain} RPC HTTP ${res.status}`);
    const out = (await res.json()) as Entry[] | Entry;
    for (const o of Array.isArray(out) ? out : [out]) done.set(o.id, o);
    // keep the answered entries; re-send only the ones rate-limited (429) or missing from the reply
    pending = pending.filter((i) => !done.has(i) || done.get(i)!.error?.code === 429);
    if (pending.length && attempt < MAX_RETRIES) {
      for (const i of pending) done.delete(i);
      await backoff(attempt);
      continue;
    }
    return reqs.map((_, i) => {
      const o = done.get(i);
      if (!o) throw new RpcError(`${chain} RPC: missing id ${i}`);
      if (o.error) throw new RpcError(`${chain} RPC: ${o.error.message}`, o.error.code);
      return o.result as T;
    });
  }
}

export async function rpc<T = string>(chain: ChainId, method: string, params: unknown[]): Promise<T> {
  const [r] = await rpcBatch<T>(chain, [{ method, params }]);
  return r;
}

/** JSON-RPC error that means the call itself reverted / hit no code (deterministic), vs. a transport failure. */
export function isRevert(e: unknown): boolean {
  return e instanceof RpcError && (e.code === 3 || /revert|execution reverted|invalid opcode/i.test(e.message));
}

export const hex = (n: number | bigint) => '0x' + n.toString(16);

/** ERC-20 selectors */
export const SEL = { totalSupply: '0x18160ddd', decimals: '0x313ce567' } as const;

export const totalSupplyReq = (token: string, block: number | 'latest'): RpcReq => ({
  method: 'eth_call',
  params: [{ to: token, data: SEL.totalSupply }, typeof block === 'number' ? hex(block) : block],
});

/** Scale a uint256 hex string by `decimals` into a JS number (precision is fine for supply in units). */
export function scaleUnits(raw: string, decimals: number): number {
  // '0x' = empty return data (no contract at that block, or not an ERC-20): never read it as zero supply
  if (raw === '0x' || raw === '') throw new RpcError('empty eth_call result (no contract at this block?)');
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}
