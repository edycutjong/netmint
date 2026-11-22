/**
 * npm run verify:flows
 * Offline replay of the served /flows tables: every underlying is re-run from ITS OWN committed CMC bodies
 * (evidence/<date>/flows/<u>-<w>d/ + the run's assets/list) and the committed chain baseline, with no network.
 * Exits 1 if any row's verdict or dollar figure differs from the committed table (so the table matches HEAD's engine).
 * --write-reasons: when every verdict and dollar figure matches, rewrite each row's derived `reason` string with the
 * replay's (wording changes in lib/flow only; numbers and verdicts are never written by this flag).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { lookup } from '../lib/lookup';
import { Recorder } from '../lib/receipts';
import { loadStoredIndex, storedTransport, storeFrom } from '../lib/stored';
import { loadFlows, rowsFromLookup } from '../lib/flows';

async function main() {
  const index = loadStoredIndex();
  const writeReasons = process.argv.includes('--write-reasons');
  let rows = 0,
    diffs = 0,
    reworded = 0;
  const pending: { file: string; table: unknown }[] = [];
  for (const w of [7, 30] as const) {
    const t = loadFlows(w);
    if (!t) throw new Error(`no flows-${w}d.json`);
    const date = t.generatedUtc.slice(0, 10);
    const folders = [...new Set(t.rows.map((r) => r.evidence))];
    const list = index.filter((s) => s.file.startsWith(path.posix.join('evidence', date, 'flows', '00-')));
    for (const ev of folders) {
      const mine = index.filter((s) => s.file.startsWith(ev + '/'));
      const want = t.rows.filter((r) => r.evidence === ev);
      const rec = new Recorder(storedTransport(storeFrom([...mine, ...list])));
      const r = await lookup(String(want[0].rwaId), { from: t.range.from, to: t.range.to, rec, allowLiveChain: false });
      const got = new Map(rowsFromLookup(r, ev).map((x) => [x.cryptoId, x]));
      for (const row of want) {
        rows++;
        const g = got.get(row.cryptoId);
        const same = g && g.verdict === row.verdict && Math.round(g.netUsd ?? 0) === Math.round(row.netUsd ?? 0);
        if (same && g && g.reason !== row.reason) {
          reworded++;
          if (writeReasons) row.reason = g.reason;
        }
        if (!same) {
          diffs++;
          console.log(
            `DIFF ${w}d ${row.symbol}: table ${row.verdict} ${Math.round(row.netUsd ?? 0)} · replay ${g?.verdict ?? 'missing'} ${Math.round(g?.netUsd ?? 0)} · ${g?.reason.slice(0, 120) ?? ''}`,
          );
        }
      }
    }
    console.log(`flows-${w}d.json (${date}): ${folders.length} underlyings replayed offline`);
    pending.push({ file: path.join('evidence', date, `flows-${w}d.json`), table: t });
  }
  console.log(`${rows} rows, ${diffs} differences, ${reworded} reason strings differ from HEAD's wording`);
  if (diffs) process.exit(1);
  if (reworded && !writeReasons) {
    console.log('stored reason strings are stale against the engine: re-derive them with `npm run verify:flows -- --write-reasons`');
    process.exit(1);
  }
  if (writeReasons && reworded) {
    for (const f of pending) writeFileSync(f.file, JSON.stringify(f.table, null, 1) + '\n');
    console.log(`--write-reasons: ${reworded} reason strings rewritten (verdicts and dollars unchanged)`);
  }
}
main().catch((e) => {
  console.error(`verify:flows failed: ${(e as Error).message}`);
  process.exit(1);
});
