/**
 * npm run bench -- [--single 20] [--serve 20] [--url https://netmint.edycu.dev] [--skip-refresh]
 * Measured, not modelled. Writes docs/proof/bench.json with raw samples AND p50/p95, so every figure in the README greps back here.
 *   single   : N sequential live lookups (NVDA, 30 d): real CMC calls + chain reads, no cache (lib/lookup.ts).
 *   refresh  : one leaderboard refresh = one live lookup for each of the top-20 underlyings (7 d window), run sequentially, i.e. the same
 *              work `npm run flows` does. Per-underlying latency gives the p50/p95; the wall time is the whole refresh.
 *   serve    : N GETs of the deployed /api/lookup (cached after the first within 60 s) and /flows, from this machine.
 * Credits are the sum of CMC credit_count over every call (from receipts), never estimated.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadKeys, assertNoSecrets } from './_env';
import { lookup } from '../lib/lookup';
import { loadFlows } from '../lib/flows';

loadKeys();
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const SINGLE = Number(flag('single') ?? 20);
const SERVE = Number(flag('serve') ?? 20);
const URL_BASE = flag('url') ?? 'https://netmint.edycu.dev';

export const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const k = Math.ceil((p / 100) * s.length) - 1; // nearest-rank
  return s[Math.min(s.length - 1, Math.max(0, k))];
};
const summary = (xs: number[]) => ({
  n: xs.length,
  p50_ms: Math.round(percentile(xs, 50)),
  p95_ms: Math.round(percentile(xs, 95)),
  min_ms: Math.round(Math.min(...xs)),
  max_ms: Math.round(Math.max(...xs)),
  samples_ms: xs.map(Math.round),
});

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const r = await fn();
  return [r, performance.now() - t0];
}

async function main() {
  const out: Record<string, unknown> = {
    captured_utc: new Date().toISOString(),
    commit: execSync('git rev-parse --short HEAD').toString().trim(),
    node: process.version,
    machine: `${process.platform}-${process.arch}`,
    url: URL_BASE,
    note: 'Client-side wall clock from one developer machine over home broadband; CMC + Alchemy latency included. Not a load test.',
  };

  // 1. single live lookup
  const single: number[] = [];
  let singleCredits = 0;
  const singleCreditsEach: number[] = [];
  for (let i = 0; i < SINGLE; i++) {
    const [r, ms] = await timed(() => lookup('NVDA', { window: 30 }));
    single.push(ms);
    singleCredits += r.credits;
    singleCreditsEach.push(r.credits);
  }
  out.single_lookup = {
    what: 'lookup(NVDA, 30 d), live CMC + chain, no result cache in the lookup path; CMC reported credit_count 0 on some immediate repeats (cause not isolated, latency does not differ), so credits_per_lookup is shown per call',
    ...summary(single),
    credits_total: singleCredits,
    credits_per_lookup: singleCreditsEach,
  };
  console.log('single', (out.single_lookup as { p50_ms: number; p95_ms: number }).p50_ms, (out.single_lookup as { p95_ms: number }).p95_ms);

  // 2. leaderboard refresh
  if (!args.includes('--skip-refresh')) {
    const flows = loadFlows(7); // the same newest 7 d table the app serves, not a hard-coded evidence date
    if (!flows) throw new Error('no flows-7d table under evidence/');
    const tickers = [...new Set(flows.rows.map((r) => r.underlying))].slice(0, 20);
    const per: number[] = [];
    let credits = 0;
    const t0 = performance.now();
    for (const t of tickers) {
      const [r, ms] = await timed(() => lookup(t, { window: 7 }));
      per.push(ms);
      credits += r.credits;
    }
    out.leaderboard_refresh = {
      what: 'one live lookup per underlying, top-20, 7 d, sequential (the work of `npm run flows -- --windows 7`)',
      underlyings: tickers.length,
      wall_ms: Math.round(performance.now() - t0),
      credits_total: credits,
      per_underlying: summary(per),
    };
    console.log('refresh wall', (out.leaderboard_refresh as { wall_ms: number }).wall_ms);
  }

  // 3. serving the deployed app
  const get = async (p: string) => {
    const t0 = performance.now();
    const res = await fetch(URL_BASE + p, { headers: { 'user-agent': 'netmint-bench/1' } });
    await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status };
  };
  const serve: Record<string, unknown> = {};
  for (const p of ['/api/lookup?u=NVDA&window=30', '/flows', '/api/health']) {
    const xs: number[] = [];
    let bad = 0;
    for (let i = 0; i < SERVE; i++) {
      const r = await get(p);
      if (r.status !== 200) bad++;
      xs.push(r.ms);
    }
    serve[p] = { ...summary(xs), non_200: bad };
  }
  out.serve = serve;

  const s = JSON.stringify(out, null, 1) + '\n';
  assertNoSecrets(s);
  mkdirSync('docs/proof', { recursive: true });
  writeFileSync('docs/proof/bench.json', s);
  console.log('wrote docs/proof/bench.json');
}

main().catch((e) => {
  console.error('bench failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
