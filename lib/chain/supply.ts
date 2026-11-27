/**
 * Summed on-chain supply per wrapper at day-boundary blocks.
 * Tier 1: committed baseline data/chain-supply/<chain>/<address>.json (daily totalSupply at the first block ≥ 00:00 UTC).
 * Tier 3: live tail over Alchemy for any day the baseline lacks (one JSON-RPC batch per chain).
 * There is no nightly job: `npm run chain-supply` refreshes the baseline before a deploy. Every live read is a receipt.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { firstBlockAtOrAfter, headBlock } from './blockIndex';
import { RpcError, SEL, scaleUnits, totalSupplyReq, type ChainId } from './rpc';
import type { Recorder } from '../receipts';
import type { ChainLeg } from '../types';

export interface Baseline {
  chain: ChainId;
  address: string;
  decimals: number;
  generated_utc: string;
  days: Record<string, number | null>;
}

const DATA = () => path.join(process.cwd(), 'data');

export function loadBaseline(chain: ChainId, address: string): Baseline | null {
  const p = path.join(DATA(), 'chain-supply', chain, `${address.toLowerCase()}.json`);
  if (!existsSync(p)) return null;
  const b = JSON.parse(readFileSync(p, 'utf8')) as Baseline;
  // leading nulls = contract not yet deployed → 0 supply on that chain; interior nulls stay unknown
  const dates = Object.keys(b.days).sort();
  const firstVal = dates.findIndex((d) => b.days[d] !== null);
  if (firstVal > 0) for (let i = 0; i < firstVal; i++) b.days[dates[i]] = 0;
  return b;
}

const blockIdx: Partial<Record<ChainId, Record<string, number>>> = {};
export function blockIndex(chain: ChainId): Record<string, number> {
  if (!blockIdx[chain]) {
    const p = path.join(DATA(), 'blocks', `${chain}.json`);
    blockIdx[chain] = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).days as Record<string, number>) : {};
  }
  return blockIdx[chain]!;
}

export interface LegSupply {
  chain: ChainId;
  address: string;
  decimals: number | null;
  values: Map<string, number | null>;
  blocks: Map<string, number | null>;
  source: 'baseline' | 'live' | 'mixed' | 'none';
  baselineUtc: string | null;
}

/**
 * Supply of each leg on each requested date. `allowLive=false` (tests, recorded runs) never touches the network.
 */
export async function legSupplies(
  rec: Recorder | null,
  legs: { chain: ChainId; address: string }[],
  dates: string[],
  opts: { allowLive?: boolean; nowMs?: number; deadlineMs?: number } = {},
): Promise<{ legs: LegSupply[]; errors: string[] }> {
  const allowLive = opts.allowLive ?? true;
  // past the deadline every remaining read is a failure (→ "chain read failed … run it again"), never a 504 from the platform
  const inTime = (chain: string) => {
    if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) throw new RpcError(`${chain} chain-read time budget exhausted`);
  };
  const now = opts.nowMs ?? Date.now();
  const errors: string[] = [];
  const out: LegSupply[] = legs.map((l) => {
    const b = loadBaseline(l.chain, l.address);
    const values = new Map<string, number | null>();
    const blocks = new Map<string, number | null>();
    for (const d of dates) {
      if (b && d in b.days) values.set(d, b.days[d]);
      blocks.set(d, blockIndex(l.chain)[d] ?? null);
    }
    return {
      chain: l.chain,
      address: l.address,
      decimals: b?.decimals ?? null,
      values,
      blocks,
      source: b ? 'baseline' : 'none',
      baselineUtc: b?.generated_utc ?? null,
    };
  });
  if (!allowLive || !rec) return { legs: out, errors };

  for (const chain of ['bsc', 'eth'] as ChainId[]) {
    const mine = out.filter((l) => l.chain === chain);
    const missing = new Set<string>();
    for (const l of mine) for (const d of dates) if (!l.values.has(d)) missing.add(d);
    if (missing.size === 0) continue;
    try {
      // resolve blocks for days the index lacks (future days stay null)
      let head: { n: number; ts: number } | null = null;
      const cache = new Map<number, number>();
      for (const d of [...missing].sort()) {
        const t = Date.parse(`${d}T00:00:00Z`) / 1000;
        if (t * 1000 > now) continue;
        if (blockIndex(chain)[d] === undefined) {
          inTime(chain);
          head ??= await headBlock(chain, opts.deadlineMs);
          if (t > head.ts) continue;
          // seed the search with the nearest known block before d (index or a day resolved earlier in this loop)
          const known = Object.entries(blockIndex(chain))
            .filter(([k]) => k < d)
            .sort(([a], [b]) => (a < b ? 1 : -1))[0];
          blockIndex(chain)[d] = await firstBlockAtOrAfter(
            chain,
            t,
            head,
            cache,
            known ? { lo: known[1], hi: head.n } : undefined,
            opts.deadlineMs,
          );
        }
      }
      // decimals for legs without a baseline
      inTime(chain);
      const noDec = mine.filter((l) => l.decimals === null);
      if (noDec.length) {
        const res = await rec.rpc<string>(
          chain,
          noDec.map((l) => ({ method: 'eth_call', params: [{ to: l.address, data: SEL.decimals }, 'latest'] })),
          { label: 'decimals', deadline: opts.deadlineMs },
        );
        noDec.forEach((l, i) => {
          // '0x' (no contract at this address on this chain) or a nonsense value: that leg stays unknown. It must not
          // throw here, or one bad address would void every other leg's read on the chain.
          try {
            const n = Number(BigInt(res[i]));
            l.decimals = Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
          } catch {
            l.decimals = null;
          }
        });
      }
      const reqs: { leg: LegSupply; date: string; block: number }[] = [];
      for (const l of mine)
        for (const d of missing) {
          if (l.values.has(d)) continue;
          const block = blockIndex(chain)[d];
          // no block yet for that day, or decimals unknown: the value is unknown, never a guessed scale
          if (block === undefined || l.decimals === null) {
            l.values.set(d, null);
            continue;
          }
          l.blocks.set(d, block);
          reqs.push({ leg: l, date: d, block });
        }
      if (reqs.length) {
        const res: string[] = [];
        for (let i = 0; i < reqs.length; i += 40) {
          inTime(chain);
          const chunk = reqs.slice(i, i + 40);
          res.push(
            ...(await rec.rpc<string>(
              chain,
              chunk.map((r) => totalSupplyReq(r.leg.address, r.block)),
              { label: 'totalSupply', deadline: opts.deadlineMs },
            )),
          );
        }
        reqs.forEach((r, i) => {
          try {
            r.leg.values.set(r.date, scaleUnits(res[i], r.leg.decimals as number));
          } catch {
            r.leg.values.set(r.date, null); // empty result: contract not deployed at that block
          }
          // baseline days + live days = mixed, however many live days there are (a second live read used to relabel it "live")
          r.leg.source = r.leg.source === 'none' || r.leg.source === 'live' ? 'live' : 'mixed';
        });
      }
    } catch (e) {
      const msg = e instanceof RpcError || e instanceof Error ? e.message : String(e);
      errors.push(msg.startsWith(`${chain} RPC`) ? msg : `${chain} RPC: ${msg}`); // one prefix, not "bsc RPC: bsc RPC: …"
      for (const l of mine) for (const d of missing) if (!l.values.has(d)) l.values.set(d, null);
    }
  }
  return { legs: out, errors };
}

/** Σ legs on a date; null if any leg is unknown that day. */
export function summed(legs: LegSupply[]): (date: string) => number | null {
  return (date) => {
    let s = 0;
    for (const l of legs) {
      const v = l.values.get(date);
      if (v === null || v === undefined) return null;
      s += v;
    }
    return s;
  };
}

export function chainLegs(legs: LegSupply[], a: string, b: string): ChainLeg[] {
  return legs.map((l) => ({
    chain: l.chain,
    address: l.address,
    decimals: l.decimals,
    supplyA: l.values.get(a) ?? null,
    supplyB: l.values.get(b) ?? null,
    blocks: [l.blocks.get(a) ?? null, l.blocks.get(b) ?? null],
    source: l.source,
  }));
}

export function sourceOf(legs: LegSupply[]): 'baseline' | 'live' | 'mixed' | 'none' {
  const s = new Set(legs.map((l) => l.source));
  if (s.size === 0) return 'none';
  if (s.size === 1) return [...s][0];
  return 'mixed';
}
