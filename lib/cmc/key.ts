import { cmcFetch } from './client';

export interface KeyPlan {
  ok: boolean;
  credit_limit_monthly: number | null;
  rate_limit_minute: number | null;
  credits_used_month: number | null;
  credits_left_month: number | null;
  error_code: number | null;
  checked_utc: string;
}

/** /v1/key/info — 0 credits; plan + usage for /api/health. Never returns the key. */
export async function keyPlan(): Promise<KeyPlan> {
  const checked_utc = new Date().toISOString();
  try {
    const c = await cmcFetch<any>('/v1/key/info', {}, { timeoutMs: 10_000 });
    const d = c.body?.data;
    return {
      ok: c.ok,
      credit_limit_monthly: d?.plan?.credit_limit_monthly ?? null,
      rate_limit_minute: d?.plan?.rate_limit_minute ?? null,
      credits_used_month: d?.usage?.current_month?.credits_used ?? null,
      credits_left_month: d?.usage?.current_month?.credits_left ?? null,
      error_code: c.ok ? null : Number(c.status?.error_code ?? c.httpStatus),
      checked_utc,
    };
  } catch {
    return {
      ok: false,
      credit_limit_monthly: null,
      rate_limit_minute: null,
      credits_used_month: null,
      credits_left_month: null,
      error_code: null,
      checked_utc,
    };
  }
}
