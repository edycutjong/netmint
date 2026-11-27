import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { keyPlan } from '@/lib/cmc/key';
import { loadFlows } from '@/lib/flows';
import { storedSummary } from '@/lib/stored';

export const dynamic = 'force-dynamic';

function baselineGenerated(): string | null {
  try {
    const p = path.join(process.cwd(), 'data', 'chain-supply', 'manifest.json');
    if (!existsSync(p)) return null;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    return m.generated_utc ?? null;
  } catch {
    return null;
  }
}

/** 200 = the service renders; the body says what is stale. `capture_utc` is the committed /flows capture, `rendered_utc` is now. */
export async function GET() {
  const plan = process.env.CMC_API_KEY ? await keyPlan() : null;
  const f30 = loadFlows(30);
  const f7 = loadFlows(7);
  return Response.json(
    {
      service: 'netmint',
      rendered_utc: new Date().toISOString(),
      commit: process.env.COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
      capture_utc: f30?.generatedUtc ?? null,
      flows: {
        '30d': f30
          ? {
              generated_utc: f30.generatedUtc,
              from: f30.range.from,
              to: f30.range.to,
              wrappers: f30.rows.length,
              underlyings: f30.universe.underlyings,
            }
          : null,
        '7d': f7
          ? {
              generated_utc: f7.generatedUtc,
              from: f7.range.from,
              to: f7.range.to,
              wrappers: f7.rows.length,
              underlyings: f7.universe.underlyings,
            }
          : null,
      },
      chain: { rpc_configured: Boolean(process.env.ALCHEMY_API_KEY), baseline_generated_utc: baselineGenerated() },
      cron_last_ok_utc: null, // no nightly job runs: `npm run flows` + redeploy refreshes /flows and the stored bodies
      // what a click falls back to if CMC refuses quotes/historical on plan or credits: committed verbatim bodies
      stored: storedSummary(),
      cmc: plan ?? { ok: false, error: 'CMC_API_KEY not configured' },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
