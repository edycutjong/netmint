/**
 * Committed chain-supply baseline: daily totalSupply at each 00:00 UTC
 * boundary block (data/blocks/<chain>.json) for every Ethereum / BNB Smart
 * Chain contract CMC lists for the wrappers below.
 *
 *   npm run chain-supply [-- <crypto_id,crypto_id,...>]
 *
 * Contracts come from a live /v2/cryptocurrency/info call (saved verbatim to
 * docs/proof/spike/info-chain-supply-set.json). Incremental per day.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cmcFetch } from '../lib/cmc/client';
import { RPC_SCRIPT, rpcBatch, totalSupplyReq, chainFromPlatform, scaleUnits, isRevert, SEL, type ChainId } from '../lib/chain/rpc';
import { loadKeys, assertNoSecrets, readJsonOr } from './_env';

loadKeys();
const ROOT = path.resolve(__dirname, '..');

// NVDA family (CMC /v5/real-world-assets/quotes/latest?rwa_id=2, 2026-11-21)
const NVDA_FAMILY = [36992, 38093, 40215, 28616, 37270, 40605, 40685, 42461];
// Seed list until the 60-wrapper universe lands: wrappers with the largest gross 90-day
// supply change × price (CMC quotes/historical, measured 2026-11-20), in rank order;
// the first TOP_N with an Ethereum or BNB Smart Chain contract are kept.
const FLOW_CANDIDATES = [
  40216, 40217, 40212, 40813, 40793, 40540, 40536, 40175, 37028, 36994, 37013, 37003, 40218, 37004, 40214, 37055, 40797, 38014, 36989,
  40613,
];
const TOP_N = 10;

const blocks = (c: ChainId) => JSON.parse(readFileSync(path.join(ROOT, `data/blocks/${c}.json`), 'utf8')).days as Record<string, number>;

interface Leg {
  crypto_id: number;
  symbol: string;
  chain: ChainId;
  address: string;
}

async function main() {
  const ids = process.argv[2] ? process.argv[2].split(',').map(Number) : [...NVDA_FAMILY, ...FLOW_CANDIDATES];
  const info = await cmcFetch<any>('/v2/cryptocurrency/info', { id: ids.join(','), aux: 'platform' });
  if (!info.ok) throw new Error(`info failed: http ${info.httpStatus} ${JSON.stringify(info.status)}`);
  const infoText = JSON.stringify(
    {
      receipt: {
        endpoint: info.endpoint,
        params: info.params,
        http_status: info.httpStatus,
        started_utc: info.startedUtc,
        elapsed_ms: info.elapsedMs,
      },
      body: info.body,
    },
    null,
    1,
  );
  assertNoSecrets(infoText);
  writeFileSync(path.join(ROOT, 'docs/proof/spike/info-chain-supply-set.json'), infoText + '\n');

  const legsOf = (id: number): Leg[] => {
    const m = info.body.data[String(id)];
    if (!m) return [];
    return (
      (m.contract_address ?? [])
        .map((c: any) => ({
          crypto_id: id,
          symbol: m.symbol,
          chain: chainFromPlatform(c.platform?.name),
          address: String(c.contract_address).toLowerCase(),
        }))
        // the address names the output file: keep only a well-formed EVM address (same rule as lib/cmc/info.ts)
        .filter((l: any) => l.chain && /^0x[0-9a-f]{40}$/.test(l.address)) as Leg[]
    );
  };
  const selected: number[] = [];
  if (process.argv[2]) selected.push(...ids);
  else {
    selected.push(...NVDA_FAMILY);
    for (const id of FLOW_CANDIDATES) {
      if (selected.length >= NVDA_FAMILY.length + TOP_N) break;
      if (legsOf(id).length) selected.push(id);
    }
  }
  const legs = selected.flatMap(legsOf);
  console.log(`${selected.length} wrappers → ${legs.length} ETH/BSC legs`);

  const idx: Record<ChainId, Record<string, number>> = { bsc: blocks('bsc'), eth: blocks('eth') };
  const manifest = [];
  for (const leg of legs) {
    const dir = path.join(ROOT, 'data/chain-supply', leg.chain);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${leg.address}.json`);
    const prev = readJsonOr<{ days?: Record<string, number | null>; decimals?: number } | null>(file, null);
    const days: Record<string, number | null> = { ...(prev?.days ?? {}) };
    let decimals = prev?.decimals as number;
    if (decimals === undefined) {
      const [d] = await rpcBatch(
        leg.chain,
        [{ method: 'eth_call', params: [{ to: leg.address, data: SEL.decimals }, 'latest'] }],
        RPC_SCRIPT,
      );
      decimals = parseInt(d, 16);
    }
    // null days are re-fetched on every run (a null is only ever written for an empty result or a revert)
    const todo = Object.entries(idx[leg.chain]).filter(([d]) => days[d] === undefined || days[d] === null);
    for (let i = 0; i < todo.length; i += 40) {
      const chunk = todo.slice(i, i + 40);
      // one batch; if any entry errors, retry singly: a revert (deterministic) → null,
      // anything else (rate limit, timeout, network) aborts the run so no transient failure is stored
      const res = await rpcBatch<string>(
        leg.chain,
        chunk.map(([, b]) => totalSupplyReq(leg.address, b)),
        RPC_SCRIPT,
      ).catch(async () => {
        const out: (string | null)[] = [];
        for (const [, b] of chunk) {
          out.push(
            await rpcBatch<string>(leg.chain, [totalSupplyReq(leg.address, b)], RPC_SCRIPT)
              .then((r) => r[0])
              .catch((e) => {
                if (isRevert(e)) return null;
                throw e;
              }),
          );
        }
        return out;
      });
      chunk.forEach(([d], k) => {
        const raw = res[k];
        days[d] = raw && raw !== '0x' ? scaleUnits(raw, decimals) : null;
      });
    }
    const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
    const out = {
      chain: leg.chain,
      address: leg.address,
      crypto_id: leg.crypto_id,
      symbol: leg.symbol,
      decimals,
      generated_utc: new Date().toISOString(),
      rule: 'totalSupply at the first block >= 00:00 UTC (data/blocks); null = empty return data or a reverted call at that block (transport errors abort the build instead)',
      days: sorted,
    };
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    const vals = Object.values(sorted).filter((v): v is number => v !== null);
    manifest.push({
      crypto_id: leg.crypto_id,
      symbol: leg.symbol,
      chain: leg.chain,
      address: leg.address,
      days: vals.length,
      first: vals[0] ?? null,
      last: vals.at(-1) ?? null,
    });
    console.log(
      `${leg.symbol.padEnd(8)} ${leg.chain} ${leg.address.slice(0, 10)} days=${vals.length} first=${vals[0]?.toFixed(2) ?? '-'} last=${vals.at(-1)?.toFixed(2) ?? '-'}`,
    );
  }
  writeFileSync(
    path.join(ROOT, 'data/chain-supply/manifest.json'),
    JSON.stringify({ generated_utc: new Date().toISOString(), wrappers: selected, legs: manifest }, null, 1) + '\n',
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
