/**
 * npm run flows -- [--top 20] [--windows 7,30] [--date YYYY-MM-DD] [--only NVDA,AAPL]
 * The leaderboard capture: the top tokenised stocks (CMC assets/list order = tokenised market cap), one live lookup per
 * underlying per window, rows flattened into evidence/<date>/flows-<w>d.json, every verbatim CMC body kept under
 * evidence/<date>/flows/<u>-<w>d/ (the repeated assets/list body is kept once, in flows/00-assets-list.json).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadKeys, assertNoSecrets } from './_env';
import { lookup, LookupFailure } from '../lib/lookup';
import { Recorder } from '../lib/receipts';
import { rowsFromLookup, sortFlows, type FlowRow, type FlowsTable } from '../lib/flows';
import type { LookupResult } from '../lib/types';

loadKeys();
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TOP = Number(flag('top') ?? 20);
const WINDOWS = (flag('windows') ?? '7,30').split(',').map(Number) as (7 | 30)[];
const only = flag('only')?.split(',').map((s) => s.toUpperCase());

const write = (p: string, v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n';
  assertNoSecrets(s);
  writeFileSync(p, s);
};

async function universe(rec: Recorder): Promise<{ symbol: string; rwaId: number }[]> {
  const call = await rec.cmc<any>('/v5/real-world-assets/assets/list', { start: '1', limit: '250' });
  if (!call.ok) throw new Error(`assets/list failed: ${call.status?.error_message}`);
  const rows: any[] = (call.body?.data?.rwa_assets ?? []).filter((a: any) => a.has_tokens === true && a.rwa_id != null && a.asset_type === 'stock');
  rows.sort((a, b) => (b.tokenized_market_cap ?? 0) - (a.tokenized_market_cap ?? 0));
  const picked = only ? rows.filter((a) => only.includes(String(a.symbol).toUpperCase())) : rows.slice(0, TOP);
  return picked.map((a) => ({ symbol: String(a.symbol), rwaId: Number(a.rwa_id) }));
}

async function main() {
  const date = flag('date') ?? new Date().toISOString().slice(0, 10);
  const root = path.join('evidence', date);
  mkdirSync(path.join(root, 'flows'), { recursive: true });
  const rec0 = new Recorder();
  const list = await universe(rec0);
  const first = rec0.receipts[0];
  write(path.join(root, 'flows', '00-assets-list.json'), { receipt: { ...first, body: undefined }, body: first.body });
  console.log(`universe: ${list.length} underlyings by tokenised market cap: ${list.map((x) => x.symbol).join(' ')}`);

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {}

  for (const w of WINDOWS) {
    const rows: FlowRow[] = [];
    const skipped: FlowsTable['skipped'] = [];
    let credits = rec0.credits, range = { from: '', to: '' };
    const results: LookupResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const a = list[next++];
        try {
          const r = await lookup(String(a.rwaId), { window: w });
          const tag = `${a.symbol.toLowerCase()}-${w}d`;
          const dir = path.join(root, 'flows', tag);
          mkdirSync(dir, { recursive: true });
          r.receipts
            .filter((x) => x.kind === 'cmc' && !x.endpoint.endsWith('/assets/list'))
            .forEach((x, i) => write(path.join(dir, `${String(i + 1).padStart(2, '0')}-${x.endpoint.replace(/^\//, '').replace(/\//g, '_')}.json`), { receipt: { ...x, body: undefined }, body: x.body }));
          rows.push(...rowsFromLookup(r, path.posix.join('evidence', date, 'flows', tag)));
          credits += r.credits;
          range = { from: r.range.from, to: r.range.to };
          results.push(r);
          console.log(`  ${w}d ${a.symbol.padEnd(6)} ${r.wrappers.filter((x) => !x.derivative).length} wrappers, ${r.credits} credits, ${r.elapsedMs} ms`);
        } catch (e) {
          const msg = e instanceof LookupFailure ? `${e.httpStatus} ${e.message}` : (e as Error).message;
          skipped.push({ underlying: a.symbol, error: msg.slice(0, 200) });
          console.log(`  ${w}d ${a.symbol.padEnd(6)} SKIPPED ${msg.slice(0, 120)}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const table: FlowsTable = {
      generatedUtc: new Date().toISOString(),
      command: `npm run flows -- ${args.join(' ')}`.trim() + ` (commit ${commit})`,
      window: w,
      range,
      universe: { underlyings: list.length - skipped.length, wrappers: rows.length, ranking: 'tokenised stocks by CMC assets/list tokenized_market_cap, top ' + list.length },
      credits,
      skipped,
      rows: sortFlows(rows),
    };
    write(path.join(root, `flows-${w}d.json`), table);
    const v = table.rows.filter((r) => r.verdict === 'REAL_INFLOW' || r.verdict === 'OUTFLOW');
    console.log(`flows-${w}d.json: ${rows.length} wrappers, ${v.length} verified, ${table.rows.filter((r) => r.divergence).length} divergent, ${skipped.length} skipped, ${credits} credits`);
  }
}
main().catch((e) => {
  console.error(`flows failed: ${(e as Error).message}`);
  process.exit(1);
});
