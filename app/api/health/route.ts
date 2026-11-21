import { keyPlan } from '@/lib/cmc/key';

export const dynamic = 'force-dynamic';

export async function GET() {
  const plan = process.env.CMC_API_KEY ? await keyPlan() : null;
  return Response.json(
    {
      service: 'netmint',
      rendered_utc: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      cmc: plan ?? { ok: false, error: 'CMC_API_KEY not configured' },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
