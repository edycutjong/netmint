/**
 * Day-boundary block index: for each UTC day from FROM to today, the first
 * block whose timestamp is >= 00:00:00 UTC, on BNB Smart Chain and Ethereum.
 * Incremental: days already in data/blocks/<chain>.json are kept.
 *
 *   npm run blocks                 (FROM defaults to 2026-07-20)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { firstBlockAtOrAfter, headBlock, type BlockIndex } from '../lib/chain/blockIndex';
import type { ChainId } from '../lib/chain/rpc';
import { loadKeys } from './_env';

loadKeys();
const FROM = process.argv[2] ?? '2026-07-20';
const DIR = path.resolve(__dirname, '../data/blocks');
mkdirSync(DIR, { recursive: true });

const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const ymd = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

async function build(chain: ChainId) {
  const file = path.join(DIR, `${chain}.json`);
  const prev: BlockIndex | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const days: Record<string, number> = { ...(prev?.days ?? {}) };
  const head = await headBlock(chain);
  const cache = new Map<number, number>([[head.n, head.ts]]);
  let probes = 0;
  const t0 = Date.now();
  let lastBlock: number | undefined;
  for (let t = dayStart(FROM); t <= head.ts; t += 86400) {
    const d = ymd(t);
    if (days[d] !== undefined) {
      lastBlock = days[d];
      continue;
    }
    const before = cache.size;
    // seed: previous boundary .. head
    const b = await firstBlockAtOrAfter(chain, t, head, cache, lastBlock !== undefined ? { lo: lastBlock, hi: head.n } : undefined);
    probes += cache.size - before;
    days[d] = b;
    lastBlock = b;
  }
  const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
  const out: BlockIndex = {
    chain,
    generated_utc: new Date().toISOString(),
    rule: 'first block with timestamp >= 00:00:00 UTC of the day',
    days: sorted,
  };
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(
    `${chain}: ${Object.keys(sorted).length} days (${Object.keys(sorted)[0]} → ${Object.keys(sorted).at(-1)}), ${probes} new probes, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

(async () => {
  await build('bsc');
  await build('eth');
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
