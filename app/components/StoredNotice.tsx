import type { LookupResult } from '@/lib/types';

/**
 * live-stored state: CMC's plan refused some calls (after the event key reverts), committed CMC bodies answered
 * them, and the verdict was still re-run on this click with the chain read live. Says exactly that, with the refusal.
 */
export function StoredNotice({ res }: { res: LookupResult }) {
  if (res.mode !== 'live-stored' || !res.stored?.length) return null;
  const first = res.stored[0];
  const captured = [...new Set(res.stored.map((s) => s.capturedUtc.slice(0, 10)))].join(', ');
  return (
    <div className="notice" role="status">
      <strong>CMC’s plan refused {res.stored.map((s) => s.endpoint).join(', ')}.</strong>{' '}
      This verdict was re-run on your click over CMC’s own responses captured {captured} UTC
      {res.history?.lastDay ? ` (daily history ends ${res.history.lastDay})` : ''}, with the chain read live
      {res.liveCmcCalls?.length ? ` and ${res.liveCmcCalls.join(', ')} answered live by CMC` : ' (CMC answered nothing live on this click)'}.
      <div className="data" style={{ marginTop: 6 }}>
        CMC {first.endpoint} → HTTP {first.liveError.httpStatus} · status.error_code {first.liveError.code} · “{first.liveError.message}”. Each stored body sits in Receipts beside the refusal.
      </div>
    </div>
  );
}
