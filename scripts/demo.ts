/**
 * npm run demo -- NVDA [--window 7|30|90] [--from YYYY-MM-DD --to YYYY-MM-DD] [--json]
 * Live: real CMC calls + chain reads. With the network unplugged it exits 1 and prints no verdict.
 */
import { loadKeys } from './_env';
import { lookup, LookupFailure, heroOf } from '../lib/lookup';
import type { LookupWindow } from '../lib/types';

loadKeys();
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const u = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'NVDA';
const w = Number(flag('window') ?? 30) as LookupWindow;

const usd = (x: number) => `${x < 0 ? '−' : '+'}$${(Math.abs(x) / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

async function main() {
  try {
    const r = await lookup(u, { window: [7, 30, 90].includes(w) ? w : 30, from: flag('from'), to: flag('to') });
    if (args.includes('--json')) {
      console.log(JSON.stringify({ ...r, receipts: r.receipts.map(({ body, ...x }) => x) }, null, 1));
      return;
    }
    console.log(`NetMint · ${r.underlying.name} (${r.underlying.ticker}, rwa_id ${r.underlying.rwaId}) · ${r.range.from} → ${r.range.to}${r.range.pinned ? ' (pinned)' : ` (${r.window} d)`}`);
    console.log(`fetched ${r.fetchedUtc} · ${r.receipts.filter((x) => x.kind === 'cmc').length} CMC calls · ${r.credits} credits · ${r.receipts.filter((x) => x.kind === 'rpc').length} RPC reads · ${r.elapsedMs} ms`);
    console.log('');
    for (const x of r.wrappers) {
      const m = x.metrics;
      const v = (x.verdict ?? (x.derivative ? 'DERIVATIVE' : 'NO VERDICT')).replace('_', ' ');
      const cov = x.mint?.coverageA != null ? `cov ${(x.mint.coverageA * 100).toFixed(1)}%` : '';
      console.log(
        `${v.padEnd(15)} ${x.symbol.padEnd(8)} ${x.issuer.slice(0, 16).padEnd(16)} ${m ? usd(m.net).padStart(10) : ''.padStart(10)} ${m ? `units ×${m.unitsX.toFixed(2)}`.padEnd(12) : ''.padEnd(12)} ${m ? `price ${pct(m.pricePct)}`.padEnd(14) : ''.padEnd(14)} ${cov}`,
      );
      console.log(`${''.padEnd(16)}${x.reason}`);
      if (x.refused.length) console.log(`${''.padEnd(16)}${x.refused.length} rows refused: ${x.refused.slice(0, 3).map((f) => `${f.reason} ${f.date}`).join(', ')}`);
    }
    const h = heroOf(r);
    if (h.wrapper?.mint) {
      const mc = h.wrapper.mint;
      console.log('');
      console.log(`HERO ${h.wrapper.symbol}: ${h.wrapper.verdict} ${usd(h.wrapper.metrics!.net)} · d = ${mc.offset} (${mc.offsetSource}) · chain ${mc.chainDates?.join(' → ')}`);
      for (const s of mc.stepDays) console.log(`  step ${s.date}: CMC 3d ${Math.round(s.cmc3d).toLocaleString('en-US')} · chain 3d ${s.chain3d === null ? 'n/a' : Math.round(s.chain3d).toLocaleString('en-US')} · ${s.ok ? 'ok' : 'FAIL'}`);
      if (h.wrapper.mintReceipt) console.log(`  mint tx ${h.wrapper.mintReceipt.tx} → ${h.wrapper.mintReceipt.recipient}`);
    }
    if (r.errors.length) console.log('errors:', r.errors);
  } catch (e) {
    if (e instanceof LookupFailure) {
      console.error(`NO VERDICT — HTTP ${e.httpStatus}: ${e.message}`);
      if (e.extra.suggestions) console.error('nearest:', e.extra.suggestions);
    } else console.error(`NO VERDICT — ${(e as Error).message}`);
    process.exit(1);
  }
}
main();
