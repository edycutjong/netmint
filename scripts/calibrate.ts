/**
 * npm run calibrate — measures, on the committed 125-day chain baseline:
 *  1. the per-issuer day offset d ∈ {−1, 0, +1}: the offset under which the most CMC step days match the chain's
 *     step on day D+d within remedy (ties → 0). Frozen into data/offsets.json; never chosen inside a tested window.
 *  2. coverage of the summed ETH+BSC legs against CMC total_supply AND circulating_supply.
 *  3. the 2026-07-31 Backed/xStocks-wide step: what the chain did that day.
 *  4. sanity-guard refusals over every series (calibrates the magnitude / spike limits).
 * Writes docs/proof/calibration/{history-baseline.json (verbatim CMC body), calibration.json}.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadKeys, assertNoSecrets } from './_env';
import { Recorder } from '../lib/receipts';
import { addDays, parseHistoryBody } from '../lib/cmc/history';
import { contractMaps } from '../lib/cmc/info';
import { sanityGuard } from '../lib/flow/sanity';
import { legSupplies, summed } from '../lib/chain/supply';
import { PARAMS } from '../lib/flow/params';
import type { DailyPoint } from '../lib/types';

loadKeys();
const OUT = path.join(process.cwd(), 'docs/proof/calibration');
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync('data/chain-supply/manifest.json', 'utf8')) as {
  wrappers: number[];
  legs: { crypto_id: number; symbol: string }[];
};
const FROM = '2026-07-20';
const TO = '2026-11-21';
const NVDA_FAMILY = new Set([36992, 38093, 40215]); // NVDAX, NVDAon, NVDAB: the kill-test wrappers (ETH/BSC legs)

async function main() {
  const rec = new Recorder();
  const ids = manifest.wrappers;
  const call = await rec.cmc<any>('/v2/cryptocurrency/quotes/historical', {
    id: ids.join(','),
    interval: 'daily',
    time_start: addDays(FROM, -1),
    time_end: TO,
  });
  if (!call.ok) throw new Error(`history failed: ${JSON.stringify(call.status)}`);
  const hist = parseHistoryBody(call.body);
  const maps = await contractMaps(rec, ids);
  const quotesMeta = await rec.cmc<any>('/v2/cryptocurrency/info', { id: ids.join(','), aux: 'platform' });
  const issuerByWrapper = new Map<number, string>();
  // issuer names come from the RWA endpoint; info has none → use rwa quotes for each wrapper's underlying via the manifest symbols
  const rwaList = await rec.cmc<any>('/v5/real-world-assets/assets/list', { start: '1', limit: '250' });
  const rwaIds: number[] = (rwaList.body?.data?.rwa_assets ?? [])
    .filter((a: any) => a.has_tokens && a.asset_type === 'stock')
    .map((a: any) => a.rwa_id);
  void quotesMeta;
  // issuer names: the first 60 ranked stock underlyings cover the manifest; stop as soon as every wrapper is named
  for (const rid of rwaIds.slice(0, 60)) {
    if (issuerByWrapper.size >= ids.length) break;
    const q = await rec.cmc<any>('/v5/real-world-assets/quotes/latest', { rwa_id: String(rid) });
    for (const t of q.body?.data?.rwa_assets?.[0]?.tokens ?? [])
      if (ids.includes(t.crypto_id)) issuerByWrapper.set(t.crypto_id, t.issuer_name);
  }

  const dates: string[] = [];
  for (let d = addDays(FROM, 0); d <= TO; d = addDays(d, 1)) dates.push(d);
  const allLegs = [...maps.values()].flatMap((m) => m.legs);
  const chain = await legSupplies(null, allLegs, dates, { allowLive: false });

  const perWrapper: any[] = [];
  const issuerVotes = new Map<string, Record<string, number>>();
  const guardTotals: Record<string, number> = {};
  for (const id of ids) {
    const raw = hist.get(id) ?? [];
    const { accepted, refused } = sanityGuard(raw);
    for (const r of refused) guardTotals[r.reason] = (guardTotals[r.reason] ?? 0) + 1;
    const map = maps.get(id)!;
    const legs = chain.legs.filter((l) => map.legs.some((m) => m.chain === l.chain && m.address === l.address));
    const chainAt = summed(legs);
    const symbol = manifest.legs.find((l) => l.crypto_id === id)?.symbol ?? String(id);
    const issuer = issuerByWrapper.get(id) ?? 'unknown';
    const tot = (p: DailyPoint) => p.totalSupply ?? p.supply;
    // step alignment
    const matches: Record<string, number> = { '-1': 0, '0': 0, '1': 0 };
    const steps: any[] = [];
    for (let i = 1; i < accepted.length; i++) {
      const a = accepted[i - 1],
        b = accepted[i];
      if (addDays(a.date, 1) !== b.date) continue;
      const step = tot(b) - tot(a);
      if (Math.abs(step) < 0.01 * tot(b) || Math.abs(step) < PARAMS.floorFrac * tot(b)) continue;
      const row: any = { date: b.date, cmc_step: step };
      for (const d of [-1, 0, 1]) {
        const c1 = chainAt(addDays(b.date, d)),
          c0 = chainAt(addDays(a.date, d));
        const cs = c1 !== null && c0 !== null ? c1 - c0 : null;
        const ok = cs !== null && Math.abs(cs - step) <= Math.max(PARAMS.remedy * Math.abs(step), PARAMS.floorFrac * tot(b));
        row[`chain_step_d${d}`] = cs;
        row[`ok_d${d}`] = ok;
        if (ok) matches[String(d)]++;
      }
      steps.push(row);
    }
    // coverage vs both CMC fields at every 30th day + first/last
    const cov = accepted
      .filter((_, i) => i === 0 || i === accepted.length - 1 || i % 30 === 0)
      .map((p) => {
        const c = chainAt(p.date);
        return {
          date: p.date,
          chain: c,
          cmc_total: p.totalSupply,
          cmc_circulating: p.supply,
          cov_total: c !== null && p.totalSupply ? c / p.totalSupply : null,
          cov_circ: c !== null ? c / p.supply : null,
        };
      });
    const jul31 = accepted.find((p) => p.date === '2026-07-31');
    const jul30 = accepted.find((p) => p.date === '2026-07-30');
    const jul =
      jul31 && jul30
        ? {
            cmc_total_step: tot(jul31) - tot(jul30),
            cmc_pct: tot(jul31) / tot(jul30) - 1,
            chain_0730: chainAt('2026-07-30'),
            chain_0731: chainAt('2026-07-31'),
            chain_0801: chainAt('2026-08-01'),
            unreadable: map.unreadable,
          }
        : null;
    perWrapper.push({
      crypto_id: id,
      symbol,
      issuer,
      legs: map.legs,
      unreadable: map.unreadable,
      points: raw.length,
      accepted: accepted.length,
      refused: refused.map((r) => ({ date: r.date, reason: r.reason, detail: r.detail })),
      step_matches: matches,
      material_steps: steps.length,
      steps,
      coverage: cov,
      jul31_step: jul,
    });
    // vote only when the summed legs hold the supply (coverage ≥ 0.9 somewhere), else the chain cannot see the steps
    if (issuer !== 'unknown' && cov.some((c) => (c.cov_total ?? c.cov_circ ?? 0) >= PARAMS.coverageMin)) {
      const v = issuerVotes.get(issuer) ?? { '-1': 0, '0': 0, '1': 0 };
      for (const k of Object.keys(matches)) v[k] += matches[k];
      issuerVotes.set(issuer, v);
    }
  }
  const issuers: Record<string, { d: -1 | 0 | 1; votes: Record<string, number> }> = {};
  for (const [iss, v] of issuerVotes) {
    const best = (['0', '-1', '1'] as const).reduce((b, k) => (v[k] > v[b] ? k : b), '0' as '0' | '-1' | '1');
    issuers[iss] = { d: Number(best) as -1 | 0 | 1, votes: v };
  }
  const offsets = {
    generated_utc: new Date().toISOString(),
    rule: 'per issuer: the d in {-1,0,+1} under which the most CMC step days (|step| >= 1% of supply) match the summed chain step on day D+d within remedy (±10%, floor 0.5%); ties -> 0; only wrappers whose summed legs reach 90% coverage vote',
    baseline: `${FROM} → ${TO}`,
    issuers,
  };
  writeFileSync('data/offsets.json', JSON.stringify(offsets, null, 1) + '\n');
  const nvdaSteps = perWrapper.filter((w) => NVDA_FAMILY.has(w.crypto_id));
  const report = {
    command: 'npm run calibrate',
    generated_utc: new Date().toISOString(),
    baseline: `${FROM} → ${TO}`,
    params: PARAMS,
    offsets: issuers,
    guard_refusals_by_reason: guardTotals,
    nvda_family: nvdaSteps.map((w) => ({
      symbol: w.symbol,
      issuer: w.issuer,
      step_matches: w.step_matches,
      material_steps: w.material_steps,
      coverage: w.coverage,
    })),
    wrappers: perWrapper,
    credits: rec.credits,
  };
  const body = JSON.stringify(
    {
      receipt: {
        endpoint: call.endpoint,
        params: call.params,
        started_utc: call.startedUtc,
        http_status: call.httpStatus,
        elapsed_ms: call.elapsedMs,
      },
      body: call.body,
    },
    null,
    1,
  );
  assertNoSecrets(body);
  writeFileSync(path.join(OUT, 'history-baseline.json'), body + '\n');
  const rep = JSON.stringify(report, null, 1);
  assertNoSecrets(rep);
  writeFileSync(path.join(OUT, 'calibration.json'), rep + '\n');
  console.log('offsets:', JSON.stringify(issuers));
  console.log('guard refusals:', JSON.stringify(guardTotals));
  for (const w of perWrapper) {
    const c0 = w.coverage[0],
      cN = w.coverage[w.coverage.length - 1];
    console.log(
      `${w.symbol.padEnd(8)} ${w.issuer.padEnd(14)} steps ${String(w.material_steps).padStart(3)} match d-1/0/+1 ${w.step_matches['-1']}/${w.step_matches['0']}/${w.step_matches['1']} cov_tot ${fmt(c0?.cov_total)}→${fmt(cN?.cov_total)} cov_circ ${fmt(c0?.cov_circ)}→${fmt(cN?.cov_circ)} refused ${w.refused.length}${w.jul31_step ? ` jul31 cmc ${(w.jul31_step.cmc_pct * 100).toFixed(0)}% chain ${w.jul31_step.chain_0730?.toFixed(0)}→${w.jul31_step.chain_0731?.toFixed(0)}→${w.jul31_step.chain_0801?.toFixed(0)}` : ''}`,
    );
  }
  console.log('credits', rec.credits);
}
const fmt = (x: number | null | undefined) => (x == null ? 'n/a' : (x * 100).toFixed(1) + '%');
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
