/** Regression tests for the architecture review of 2026-11-28 (what the live rail tickers and a fresh read turned up). */
import { describe, expect, it } from 'vitest';
import { isUtcDay } from '@/lib/cmc/history';
import { lookup, LookupFailure } from '@/lib/lookup';
import { parseLookupParams } from '@/lib/lookupParams';
import { Recorder } from '@/lib/receipts';
import { recordedTransport } from './helpers';

describe('window dates must be real calendar days', () => {
  it('isUtcDay', () => {
    for (const ok of ['2026-11-21', '2024-02-29', '2026-12-31']) expect(isUtcDay(ok), ok).toBe(true);
    for (const bad of ['2026-11-31', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '2025-02-29', '26-11-21', '2026-11-21T00:00'])
      expect(isUtcDay(bad), bad).toBe(false);
  });

  it('/api/lookup params: a day that does not exist is a 400, before any CMC call', () => {
    const p = (from: string, to: string) => parseLookupParams(new URLSearchParams({ u: 'NVDA', from, to }));
    expect(p('2026-10-22', '2026-11-21').ok).toBe(true);
    for (const [from, to] of [
      ['2026-10-22', '2026-11-31'], // was accepted and printed as the window's last day
      ['2026-02-30', '2026-03-05'],
      ['2026-13-01', '2026-13-09'], // was a 500 after four CMC calls
      ['2026-11-00', '2026-11-21'],
    ]) {
      const r = p(from, to);
      expect(r.ok, `${from}..${to}`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/real calendar days/);
    }
  });

  it('lookup() itself refuses them too (scripts call it directly), with no CMC call made', async () => {
    const rec = new Recorder(recordedTransport());
    const e = (await lookup('NVDA', { from: '2026-10-22', to: '2026-11-31', rec, allowLiveChain: false }).catch((x) => x)) as LookupFailure;
    expect(e).toBeInstanceOf(LookupFailure);
    expect(e.httpStatus).toBe(400);
    expect(rec.receipts).toHaveLength(0);
  });
});
