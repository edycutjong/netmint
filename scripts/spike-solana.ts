/**
 * Solana supply probe: getTokenSupply on the NVDAX mint (address from
 * /v2/cryptocurrency/info, docs/proof/spike/info-nvda-family.json), once plain
 * and once with a past `slot` in the config, against the public Solana RPC.
 *
 *   npm run spike:solana
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, '../docs/proof/spike');
const RPC = 'https://api.mainnet-beta.solana.com';

async function call(params: unknown[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params }),
    signal: AbortSignal.timeout(20_000),
  });
  return { params, http_status: res.status, response: await res.json() };
}

async function main() {
  const info = JSON.parse(readFileSync(path.join(DIR, 'info-nvda-family.json'), 'utf8'));
  const mint: string = info.body.data['36992'].contract_address.find((c: any) => c.platform?.name === 'Solana').contract_address;
  const a = await call([mint]);
  const b = await call([mint, { commitment: 'finalized', slot: 300000000 }]);
  const same = JSON.stringify(a.response.result?.context) === JSON.stringify(b.response.result?.context) && a.response.result?.value?.amount === b.response.result?.value?.amount;
  const out = {
    captured_utc: new Date().toISOString(),
    command: 'npm run spike:solana',
    question: "Can NetMint read a Solana mint's token supply at a past day boundary through standard JSON-RPC?",
    rpc: RPC,
    token: { symbol: 'NVDAX', crypto_id: 36992, chain: 'solana', mint },
    observed: same
      ? 'getTokenSupply returned the current supply with the current context slot both times; the past `slot` passed in the config was ignored (same context.slot and amount).'
      : 'the two calls differed; inspect `calls` before drawing a conclusion.',
    docs_note: 'The Solana docs page https://solana.com/docs/rpc/http/gettokensupply answered HTTP 429 to our fetch on 2026-11-21, so this records observed behaviour only, not the docs text.',
    consequence: 'NetMint does not verify Solana legs historically. They are reported as not verifiable on chain; coverage.json gives the share of CMC supply on Ethereum + BNB Smart Chain per wrapper (NVDAX: see coverage.json).',
    calls: [a, b],
  };
  writeFileSync(path.join(DIR, 'solana-supply.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(out.observed);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
