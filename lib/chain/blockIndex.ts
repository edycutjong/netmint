import { RPC_REQUEST, rpcBatch, hex, type ChainId } from './rpc';

/** Day-boundary block index: first block with timestamp >= 00:00 UTC of each day. */
export interface BlockIndex {
  chain: ChainId;
  generated_utc: string;
  rule: string;
  days: Record<string, number>;
}

type Block = { number: string; timestamp: string };

export async function headBlock(chain: ChainId, deadline?: number): Promise<{ n: number; ts: number }> {
  const [b] = await rpcBatch<Block>(chain, [{ method: 'eth_getBlockByNumber', params: ['latest', false] }], { ...RPC_REQUEST, deadline });
  return { n: parseInt(b.number, 16), ts: parseInt(b.timestamp, 16) };
}

export async function blockTimestamps(chain: ChainId, ns: number[], deadline?: number): Promise<number[]> {
  const res = await rpcBatch<Block>(
    chain,
    ns.map((n) => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })),
    { ...RPC_REQUEST, deadline },
  );
  return res.map((b) => parseInt(b.timestamp, 16));
}

/**
 * First block with timestamp >= t. Interpolation search seeded by a guess,
 * finished by binary search; each probe is one RPC (cached).
 */
export async function firstBlockAtOrAfter(
  chain: ChainId,
  t: number,
  head: { n: number; ts: number },
  cache: Map<number, number>,
  seed?: { lo: number; hi: number },
  deadline?: number,
): Promise<number> {
  const ts = async (n: number) => {
    let v = cache.get(n);
    if (v === undefined) {
      [v] = await blockTimestamps(chain, [n], deadline); // every probe is bounded by the lookup's chain-read deadline
      cache.set(n, v);
    }
    return v;
  };
  let lo = seed?.lo ?? 0;
  let hi = seed?.hi ?? head.n;
  // widen until ts(lo) < t <= ts(hi)
  while (lo > 0 && (await ts(lo)) >= t) lo = Math.max(0, lo - (hi - lo) * 2 - 1000);
  if ((await ts(hi)) < t) throw new Error(`${chain}: no block at or after ${t} yet`);
  // interpolation steps then binary
  for (let i = 0; hi - lo > 1; i++) {
    const tl = await ts(lo);
    const th = await ts(hi);
    let m: number;
    if (i < 6 && th > tl) {
      m = lo + Math.floor(((t - tl) / (th - tl)) * (hi - lo));
      m = Math.min(hi - 1, Math.max(lo + 1, m));
    } else {
      m = Math.floor((lo + hi) / 2);
    }
    if ((await ts(m)) < t) lo = m;
    else hi = m;
  }
  return (await ts(lo)) >= t ? lo : hi;
}
