/**
 * npm run find-mint -- <crypto_id> <chain> <address> <symbol> <YYYY-MM-DD>...
 * For each step day D (CMC point D 00:00 vs D−1 00:00, d = 0), bisect totalSupply between block_at(D−1) and block_at(D)
 * to the block where supply crosses half of the day's step, then read a 10-block eth_getLogs window (the Alchemy
 * free-tier cap) for Transfer(0x0 → recipient) and keep the largest mint. Results merge into data/mints.json; the
 * verbatim logs go to docs/proof/mints/. Never runs inside a user request.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadKeys, assertNoSecrets } from './_env';
import { EXPLORER, rpcBatch, scaleUnits, totalSupplyReq, hex, SEL, type ChainId } from '../lib/chain/rpc';
import { addDays } from '../lib/cmc/history';
import type { MintReceipt } from '../lib/types';

loadKeys();
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const [idArg, chainArg, address, symbol, ...days] = process.argv.slice(2);
const chain = chainArg as ChainId;
const blocks = JSON.parse(readFileSync(`data/blocks/${chain}.json`, 'utf8')).days as Record<string, number>;

async function supplyAt(block: number, dec: number): Promise<number> {
  const [r] = await rpcBatch<string>(chain, [totalSupplyReq(address, block)]);
  return scaleUnits(r, dec);
}

async function main() {
  if (!idArg || !address || days.length === 0) throw new Error('usage: find-mint <crypto_id> <chain> <address> <symbol> <date>...');
  const [decHex] = await rpcBatch<string>(chain, [{ method: 'eth_call', params: [{ to: address, data: SEL.decimals }, 'latest'] }]);
  const dec = Number(BigInt(decHex));
  const found: MintReceipt[] = [];
  const raw: unknown[] = [];
  for (const D of days) {
    let lo = blocks[addDays(D, -1)],
      hi = blocks[D];
    if (lo === undefined || hi === undefined) {
      console.log(`${D}: no block index`);
      continue;
    }
    const s0 = await supplyAt(lo, dec),
      s1 = await supplyAt(hi, dec);
    const step = s1 - s0;
    if (step <= 0) {
      console.log(`${D}: chain step ${step.toFixed(2)} ≤ 0, no mint to find`);
      continue;
    }
    const target = s0 + step / 2;
    while (hi - lo > 1) {
      const m = Math.floor((lo + hi) / 2);
      if ((await supplyAt(m, dec)) >= target) hi = m;
      else lo = m;
    }
    const logs = await rpcBatch<any[]>(chain, [
      { method: 'eth_getLogs', params: [{ address, fromBlock: hex(hi - 9), toBlock: hex(hi), topics: [TRANSFER, ZERO_TOPIC] }] },
    ]);
    const mints = (logs[0] ?? []).map((l: any) => ({
      tx: l.transactionHash as string,
      block: parseInt(l.blockNumber, 16),
      recipient: '0x' + String(l.topics[2]).slice(26),
      amount: scaleUnits(l.data, dec),
    }));
    raw.push({ date: D, chain_step: step, crossing_block: hi, logs: logs[0] });
    const best = mints.sort((a: any, b: any) => b.amount - a.amount)[0];
    if (!best) {
      console.log(`${D}: crossing at block ${hi} but no zero-address Transfer in the 10-block window`);
      continue;
    }
    found.push({
      crypto_id: Number(idArg),
      symbol,
      chain,
      date: D,
      tx: best.tx,
      block: best.block,
      amount: best.amount,
      recipient: best.recipient,
      explorer_url: `${EXPLORER[chain]}/tx/${best.tx}`,
    });
    console.log(
      `${D}: chain step +${step.toFixed(0)} · mint ${best.amount.toFixed(2)} in ${best.tx} (block ${best.block}) → ${best.recipient}`,
    );
  }
  const path = 'data/mints.json';
  const prev: MintReceipt[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const merged = [...prev.filter((p) => !found.some((f) => f.crypto_id === p.crypto_id && f.date === p.date)), ...found].sort(
    (a, b) => a.crypto_id - b.crypto_id || a.date.localeCompare(b.date),
  );
  writeFileSync(path, JSON.stringify(merged, null, 1) + '\n');
  mkdirSync('docs/proof/mints', { recursive: true });
  const out = JSON.stringify(
    {
      command: `npm run find-mint -- ${process.argv.slice(2).join(' ')}`,
      generated_utc: new Date().toISOString(),
      chain,
      address,
      decimals: dec,
      days: raw,
    },
    null,
    1,
  );
  assertNoSecrets(out);
  writeFileSync(`docs/proof/mints/${symbol.toLowerCase()}-${chain}.json`, out + '\n');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
