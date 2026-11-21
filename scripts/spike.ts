/**
 * P1a spike: call every CMC endpoint the core flow uses, live, and save each
 * verbatim response to docs/proof/spike/. Prints one line per endpoint with
 * HTTP status, CMC error_code, credit_count and latency.
 *
 *   npm run spike
 *
 * Unplug the network and this script fails; it never fabricates a body.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cmcFetch, cmcErrorCode, type CmcCall } from '../lib/cmc/client';
import { loadKeys, assertNoSecrets } from './_env';

loadKeys();
const OUT = path.resolve(__dirname, '../docs/proof/spike');
mkdirSync(OUT, { recursive: true });

type Row = { n: string; file: string; endpoint: string; params: Record<string, string>; method: string; http: number; error_code: number; error_message: string | null; credit_count: number | null; elapsed_ms: number; ok: boolean; note?: string };
const rows: Row[] = [];

function save<T = any>(n: string, file: string, call: CmcCall<T>, note?: string): CmcCall<T> {
  const text = JSON.stringify(
    { receipt: { endpoint: call.endpoint, method: call.method, params: call.params, http_status: call.httpStatus, started_utc: call.startedUtc, elapsed_ms: call.elapsedMs }, body: call.body },
    null,
    1,
  );
  assertNoSecrets(text);
  writeFileSync(path.join(OUT, file), text + '\n');
  const r: Row = { n, file, endpoint: call.endpoint, params: call.params, method: call.method, http: call.httpStatus, error_code: cmcErrorCode(call.status), error_message: call.status?.error_message ?? null, credit_count: call.status?.credit_count ?? null, elapsed_ms: call.elapsedMs, ok: call.ok, note };
  rows.push(r);
  console.log(`${call.ok ? 'OK  ' : 'FAIL'} #${n.padEnd(3)} ${call.method} ${call.endpoint} http=${call.httpStatus} code=${r.error_code} credits=${r.credit_count ?? '-'} ${call.elapsedMs}ms ${note ?? ''}`);
  return call;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const today = new Date();
  const end = ymd(today);
  const start90 = ymd(new Date(today.getTime() - 90 * 86400_000));

  // 7. key info (plan + credits)
  save('7', 'key-info.json', await cmcFetch('/v1/key/info'));

  // 1. RWA universe (paged)
  // the spike proves paging on 2 pages; lib/cmc/rwa.ts pages until has_tokens rows run out
  // limit is capped at 250 by the API (4001 "limit must be between 1 and 250"), so page with start
  const assets: any[] = [];
  for (let start = 1, page = 1; page <= 2; page++, start += 250) {
    const c = save(page === 1 ? '1' : `1.${page}`, `rwa-assets-list-p${page}.json`, await cmcFetch<any>('/v5/real-world-assets/assets/list', { start: String(start), limit: '250' }));
    const d = c.body?.data;
    const arr: any[] = Array.isArray(d) ? d : (d?.rwa_assets ?? d?.list ?? d?.assets ?? []);
    assets.push(...arr);
    if (!c.ok || arr.length < 250) break;
  }
  console.log(`     universe: ${assets.length} RWA assets listed`);
  const nvda = assets.find((a) => String(a.symbol ?? '').toUpperCase() === 'NVDA');
  const rwaId = String(nvda?.rwa_id ?? nvda?.id ?? '2');

  // 2. every wrapper of NVDA
  const rq = save('2', 'rwa-quotes-latest-nvda.json', await cmcFetch<any>('/v5/real-world-assets/quotes/latest', { rwa_id: rwaId }), `rwa_id=${rwaId}${nvda ? '' : ' (fallback id; NVDA not matched in list)'}`);
  const d2 = rq.body?.data;
  const node = d2?.rwa_assets?.[0] ?? (Array.isArray(d2) ? d2[0] : d2);
  const tokens: any[] = node?.tokens ?? [];
  const ids = tokens.map((t) => t.crypto_id ?? t.id).filter((x) => x != null).map(String);
  const nvdaIds = ids.length ? ids : ['40215', '36992', '38093', '40685', '40605', '37270', '42461'];

  // 3. daily supply history (hero wrapper NVDAB id 40215, 90 d)
  save('3', 'quotes-historical-nvdab-90d.json', await cmcFetch('/v2/cryptocurrency/quotes/historical', { id: '40215', interval: 'daily', time_start: start90, time_end: end }));

  // 3b. oldest date the key returns for quotes/historical (BTC from 2013 asks the plan's depth limit)
  save('3b', 'quotes-historical-oldest-probe.json', await cmcFetch('/v2/cryptocurrency/quotes/historical', { id: '1', interval: 'daily', time_start: '2013-04-28', count: '3' }), 'depth probe');

  // 4. contract addresses per chain (batched ids)
  save('4', 'info-nvda-family.json', await cmcFetch('/v2/cryptocurrency/info', { id: nvdaIds.join(','), aux: 'platform' }));

  // 5. holder count per chain
  save('5', 'holders-count-nvdab-bsc.json', await cmcFetch('/v1/dex/holders/count', { platform: 'bsc', tokenAddress: '0x02fca66c1d1afb4e2a7884261eb00f63598a7436' }));

  // 6. today's point (display-only) for the family
  save('6', 'quotes-latest-nvda-family.json', await cmcFetch('/v2/cryptocurrency/quotes/latest', { id: nvdaIds.join(',') }));

  // (8) top holders — one more try per shape, never blocking
  const addr = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436';
  const shapes: Array<[string, Parameters<typeof cmcFetch>[1], Parameters<typeof cmcFetch>[2]]> = [
    ['8a', {}, { method: 'POST', jsonBody: { platform: 'bsc', tokenAddress: addr, limit: 20 } }],
    ['8b', { platform: 'bsc', tokenAddress: addr, limit: '20' }, { method: 'POST' }],
    ['8c', { platform: 'bsc', tokenAddress: addr, limit: '20' }, { method: 'GET' }],
    ['8d', {}, { method: 'POST', jsonBody: { network: 'bsc', address: addr, page: 1, pageSize: 20 } }],
  ];
  for (const [n, q, o] of shapes) {
    const c = await cmcFetch('/v1/dex/holders/list', q, o);
    save(n, `holders-list-try-${n}.json`, c, o?.jsonBody ? `body=${JSON.stringify(o.jsonBody)}` : `query`);
    if (c.ok) break;
  }

  // plan/entitlement error codes (for the revert classifier): endpoints outside a Growth-style plan
  // (listings/historical, market-pairs, price-performance-stats are all inside this key's plan; blockchain/statistics is not)
  save('E1', 'plan-error-probe-blockchain-statistics.json', await cmcFetch('/v1/blockchain/statistics/latest', { id: '1' }), 'plan probe');
  save('E2', 'plan-error-probe-bad-key.json', await cmcFetch('/v1/key/info', {}, { apiKey: '00000000-0000-0000-0000-000000000000' }), 'invalid key probe');

  const summary = { generated_utc: new Date().toISOString(), command: 'npm run spike', rows };
  const text = JSON.stringify(summary, null, 1);
  assertNoSecrets(text);
  writeFileSync(path.join(OUT, 'summary.json'), text + '\n');
  const core = rows.filter((r) => /^[1-7]$/.test(r.n)); // first page of each core endpoint
  console.log(`\ncore endpoints OK: ${core.filter((r) => r.ok).length}/${core.length} · credits used: ${rows.reduce((s, r) => s + (r.credit_count ?? 0), 0)}`);
  if (core.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
