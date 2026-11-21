/**
 * ETH + BSC supply coverage for one underlying's wrappers: how much of CMC's
 * reported supply sits on the two chains NetMint can verify historically.
 * Reads the spike's verbatim CMC bodies (info + quotes/latest) and reads
 * totalSupply live on both chains at the current head block.
 *
 *   npm run coverage:supply            (after npm run spike)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RPC_SCRIPT, rpcBatch, totalSupplyReq, chainFromPlatform, scaleUnits, SEL, type ChainId } from '../lib/chain/rpc';
import { headBlock } from '../lib/chain/blockIndex';
import { loadKeys, assertNoSecrets } from './_env';

loadKeys();
const DIR = path.resolve(__dirname, '../docs/proof/spike');
const read = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));

async function main() {
  const info = read('info-nvda-family.json');
  const ql = read('quotes-latest-nvda-family.json');
  const heads: Record<ChainId, { n: number; ts: number }> = { bsc: await headBlock('bsc'), eth: await headBlock('eth') };
  const rows = [];
  for (const [id, meta] of Object.entries<any>(info.body.data)) {
    const q = ql.body.data[id] ?? {};
    const cmcCirc: number | null = q.circulating_supply ?? null;
    const cmcTotal: number | null = q.total_supply ?? null;
    const allChains = (meta.contract_address ?? []).map((c: any) => c.platform?.name as string);
    const legs: any[] = [];
    for (const c of meta.contract_address ?? []) {
      const chain = chainFromPlatform(c.platform?.name);
      if (!chain) continue;
      const addr: string = c.contract_address;
      const block = heads[chain].n;
      const [dec, sup] = await rpcBatch(
        chain,
        [{ method: 'eth_call', params: [{ to: addr, data: SEL.decimals }, '0x' + block.toString(16)] }, totalSupplyReq(addr, block)],
        RPC_SCRIPT,
      );
      const decimals = parseInt(dec, 16);
      legs.push({
        chain,
        address: addr,
        block,
        block_utc: new Date(heads[chain].ts * 1000).toISOString(),
        decimals,
        totalSupply: scaleUnits(sup, decimals),
      });
    }
    const onEthBsc = legs.reduce((s, l) => s + l.totalSupply, 0);
    const denom = cmcTotal ?? cmcCirc;
    rows.push({
      crypto_id: Number(id),
      symbol: meta.symbol,
      issuer_chain_list: allChains,
      cmc_circulating_supply: cmcCirc,
      cmc_total_supply: cmcTotal,
      eth_bsc_legs: legs,
      eth_bsc_total_supply: legs.length ? onEthBsc : null,
      coverage_vs_cmc_total: legs.length && denom ? onEthBsc / denom : null,
      verifiable_on_eth_bsc: legs.length > 0,
    });
    console.log(
      `${meta.symbol.padEnd(8)} legs=${legs.map((l) => l.chain).join('+') || '-'} eth+bsc=${legs.length ? onEthBsc.toFixed(2) : '-'} cmcTotal=${cmcTotal ?? '-'} coverage=${legs.length && denom ? ((onEthBsc / denom) * 100).toFixed(1) + '%' : 'n/a'}`,
    );
  }
  const out = {
    generated_utc: new Date().toISOString(),
    command: 'npm run coverage:supply',
    underlying: 'NVDA',
    cmc_sources: ['docs/proof/spike/info-nvda-family.json', 'docs/proof/spike/quotes-latest-nvda-family.json'],
    cmc_capture_utc: ql.receipt.started_utc,
    chain_heads: heads,
    note: 'coverage = (sum of totalSupply on the Ethereum + BNB Smart Chain contracts CMC lists) / CMC total_supply (circulating if total is null). Chain reads at head; CMC values a few minutes older.',
    rows,
  };
  const text = JSON.stringify(out, null, 1);
  assertNoSecrets(text);
  writeFileSync(path.join(DIR, 'coverage.json'), text + '\n');
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
