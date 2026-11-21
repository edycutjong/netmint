/**
 * Chain spike: (1) verify the block index on sample days (block b has
 * ts >= 00:00 UTC and block b-1 has ts < 00:00 UTC); (2) one live
 * eth_call totalSupply for the hero wrapper NVDAB at two day boundaries,
 * request + raw response recorded verbatim, with latency.
 *
 *   npm run spike:chain
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blockTimestamps } from '../lib/chain/blockIndex';
import { RPC_SCRIPT, rpcBatch, totalSupplyReq, scaleUnits, EXPLORER, type ChainId } from '../lib/chain/rpc';
import { loadKeys, assertNoSecrets } from './_env';

loadKeys();
const ROOT = path.resolve(__dirname, '..');
const idx = (c: ChainId) => JSON.parse(readFileSync(path.join(ROOT, `data/blocks/${c}.json`), 'utf8')).days as Record<string, number>;

async function main() {
  const checks: unknown[] = [];
  let bad = 0;
  for (const chain of ['bsc', 'eth'] as ChainId[]) {
    const days = idx(chain);
    const keys = Object.keys(days);
    const sample = [keys[0], keys[Math.floor(keys.length / 2)], '2026-11-13', keys.at(-1)!].filter(
      (d, i, a) => days[d] && a.indexOf(d) === i,
    );
    for (const d of sample) {
      const b = days[d];
      const [tsPrev, ts] = await blockTimestamps(chain, [b - 1, b]);
      const t = Date.parse(`${d}T00:00:00Z`) / 1000;
      const ok = ts >= t && tsPrev < t;
      if (!ok) bad++;
      checks.push({ chain, day: d, block: b, ts_block: ts, ts_prev_block: tsPrev, day_start: t, ok });
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${chain} ${d} block ${b} ts=${ts} prev=${tsPrev} t=${t}`);
    }
  }
  // NVDAB (crypto_id 40215) on BNB Smart Chain, address from /v2/cryptocurrency/info (spike/info-nvda-family.json)
  const token = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436';
  const bsc = idx('bsc');
  const calls = [];
  for (const d of ['2026-11-13', '2026-11-14']) {
    const req = totalSupplyReq(token, bsc[d]);
    const t0 = performance.now();
    const [raw] = await rpcBatch('bsc', [req], RPC_SCRIPT);
    const ms = Math.round(performance.now() - t0);
    calls.push({
      chain: 'bsc',
      day: d,
      block: bsc[d],
      block_url: `${EXPLORER.bsc}/block/${bsc[d]}`,
      request: { jsonrpc: '2.0', ...req },
      raw_result: raw,
      decimals: 18,
      totalSupply: scaleUnits(raw, 18),
      elapsed_ms: ms,
    });
    console.log(`eth_call totalSupply NVDAB @ ${d} block ${bsc[d]} = ${scaleUnits(raw, 18).toFixed(4)} (${ms} ms)`);
  }
  const out = {
    generated_utc: new Date().toISOString(),
    command: 'npm run spike:chain',
    provider: 'Alchemy archive JSON-RPC (bnb-mainnet, eth-mainnet); URL withheld (key in path)',
    token: { symbol: 'NVDAB', crypto_id: 40215, chain: 'bsc', address: token },
    block_index_checks: checks,
    total_supply_calls: calls,
  };
  const text = JSON.stringify(out, null, 1);
  assertNoSecrets(text);
  writeFileSync(path.join(ROOT, 'docs/proof/spike/chain-boundary.json'), text + '\n');
  if (bad) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
