/**
 * npm run snapshot -- [NVDA] [--window 30] [--date YYYY-MM-DD]
 * Records reality: one live lookup → evidence/<date>/<u>-<window>d/ with every verbatim CMC body, the computed
 * table.json and a README (command, time, commit), plus docs/proof/<date>/<u>-<window>d-receipts.json.
 * Every README / landing figure must grep to a committed snapshot.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadKeys, assertNoSecrets } from './_env';
import { lookup, heroOf } from '../lib/lookup';
import { Recorder } from '../lib/receipts';
import { rpcBatch, RPC_SCRIPT } from '../lib/chain/rpc';
import type { LookupWindow } from '../lib/types';

loadKeys();
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const u = (args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'NVDA').toUpperCase();
const win = Number(flag('window') ?? 30) as LookupWindow;

async function main() {
  const rec = new Recorder(undefined, (c, q) => rpcBatch(c, q, RPC_SCRIPT));
  const r = await lookup(u, { window: win, from: flag('from'), to: flag('to'), rec });
  const date = flag('date') ?? r.fetchedUtc.slice(0, 10);
  const tag = r.range.pinned ? `${u.toLowerCase()}-${r.range.from}_${r.range.to}` : `${u.toLowerCase()}-${win}d`;
  const ev = path.join('evidence', date, tag);
  const proof = path.join('docs/proof', date);
  mkdirSync(ev, { recursive: true });
  mkdirSync(proof, { recursive: true });
  const write = (p: string, v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n';
    assertNoSecrets(s);
    writeFileSync(p, s);
  };
  r.receipts
    .filter((x) => x.kind === 'cmc')
    .forEach((x, i) =>
      write(path.join(ev, `${String(i + 1).padStart(2, '0')}-${x.endpoint.replace(/^\//, '').replace(/\//g, '_')}.json`), {
        receipt: { ...x, body: undefined },
        body: rec.archiveBody(x),
      }),
    );
  const table = {
    command: `npm run snapshot -- ${args.join(' ')}`.trim(),
    fetched_utc: r.fetchedUtc,
    underlying: r.underlying,
    window: r.window,
    range: r.range,
    credits: r.credits,
    elapsed_ms: r.elapsedMs,
    hero: heroOf(r).wrapper?.symbol ?? null,
    wrappers: r.wrappers.map((w) => ({
      crypto_id: w.cryptoId,
      symbol: w.symbol,
      issuer: w.issuer,
      verdict: w.verdict,
      reason: w.reason,
      net_usd: w.metrics?.net ?? null,
      gross_in_usd: w.metrics?.grossIn ?? null,
      gross_out_usd: w.metrics?.grossOut ?? null,
      units_x: w.metrics?.unitsX ?? null,
      price_pct: w.metrics?.pricePct ?? null,
      supply_a: w.metrics?.supplyA ?? null,
      supply_b: w.metrics?.supplyB ?? null,
      price_a: w.metrics?.priceA ?? null,
      price_b: w.metrics?.priceB ?? null,
      exit_ratio: w.exitRatio,
      coverage_a: w.mint?.coverageA ?? null,
      mint: w.mint
        ? {
            status: w.mint.status,
            comparator: w.mint.comparator,
            offset: w.mint.offset,
            cmc_delta: w.mint.cmcDelta,
            chain_delta: w.mint.chainDelta,
            err_pct: w.mint.errPct,
            chain_source: w.mint.chainSource,
            chain_dates: w.mint.chainDates,
            step_days: w.mint.stepDays,
            legs: w.mint.legs,
          }
        : null,
      proof: w.proof ?? null,
      mint_receipt: w.mintReceipt ?? null,
      refused: w.refused.map((f) => ({ date: f.date, reason: f.reason, detail: f.detail })),
    })),
  };
  write(path.join(ev, 'table.json'), table);
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {}
  write(
    path.join(ev, 'README.md'),
    `# Evidence: ${u} ${r.range.from} → ${r.range.to}\n\n- Command: \`${table.command}\`\n- Fetched: ${r.fetchedUtc}\n- Commit: ${commit}\n- CMC credits: ${r.credits}\n- Files: one verbatim CMC body per call (numbered in call order) + \`table.json\` (computed verdicts)\n- Chain values: the committed daily baseline in \`data/chain-supply/\` (chain source per wrapper in table.json)\n`,
  );
  write(
    path.join(proof, `${tag}-receipts.json`),
    r.receipts.map((x) => ({ ...x, body: x.kind === 'cmc' ? '(verbatim body in evidence/)' : x.body })),
  );
  console.log(`wrote ${ev} (${r.receipts.length} receipts, ${r.credits} credits); hero ${table.hero}`);
  for (const w of table.wrappers)
    console.log(`${String(w.verdict).padEnd(15)} ${w.symbol.padEnd(8)} ${w.net_usd === null ? '' : (w.net_usd / 1e6).toFixed(2) + 'M'}`);
}
main().catch((e) => {
  console.error(`snapshot failed: ${(e as Error).message}`);
  process.exit(1);
});
