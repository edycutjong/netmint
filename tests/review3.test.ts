/** Regression tests for the architecture review of 2026-11-28 (what the live rail tickers and a fresh read turned up). */
import { describe, expect, it } from 'vitest';
import type { CmcCall } from '@/lib/cmc/client';
import { isUtcDay } from '@/lib/cmc/history';
import { wrappersOf } from '@/lib/cmc/rwa';
import { lookup, LookupFailure, heroOf } from '@/lib/lookup';
import { parseLookupParams } from '@/lib/lookupParams';
import { Recorder } from '@/lib/receipts';
import { fixture, NOW, recordedTransport } from './helpers';

const INFO = '/v2/cryptocurrency/info';
const RWA_QUOTES = '/v5/real-world-assets/quotes/latest';
const GHOST = 39002; // the id CMC listed under HOOD with no symbol, issuer or market cap (2026-11-27)

/** The NVDA wrapper list with one more token row appended. */
const rwaWith = (token: Record<string, unknown>) => {
  const body = structuredClone(fixture('recorded/rwa-quotes-nvda.json').body);
  body.data.rwa_assets[0].tokens.push(token);
  return body;
};

describe('a wrapper id that /v2/cryptocurrency/info rejects (HOOD, 2026-11-27)', () => {
  // CMC's real behaviour, measured: the plain multi-id call is a 400 naming the id; skip_invalid=true answers for the rest
  const transport = () => {
    const base = recordedTransport({
      [RWA_QUOTES]: { body: rwaWith({ crypto_id: GHOST, symbol: null, name: null, issuer_name: null, market_cap: null }) },
    });
    const seen: Record<string, string>[] = [];
    const t = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<CmcCall<T>> => {
      if (endpoint !== INFO) return base<T>(endpoint, params);
      seen.push(params);
      if (params.skip_invalid === 'true') return base<T>(endpoint, params);
      const body = { status: { error_code: 400, error_message: `Invalid value for 'id': '${GHOST}'`, credit_count: 0 } };
      return {
        endpoint,
        params,
        method: 'GET',
        httpStatus: 400,
        ok: false,
        startedUtc: '2026-11-27T18:36:00.000Z',
        elapsedMs: 1,
        status: body.status,
        body: body as T,
      };
    };
    return { t, seen };
  };

  it('retries once with skip_invalid=true, so the other wrappers keep their verdicts', async () => {
    const { t, seen } = transport();
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(t) });
    expect(heroOf(r).wrapper!.symbol).toBe('NVDAB');
    expect(heroOf(r).wrapper!.verdict).toBe('REAL_INFLOW');
    expect(seen.map((p) => p.skip_invalid ?? null)).toEqual([null, 'true']);
    expect(seen[0].id.split(',')).toContain(String(GHOST)); // the first call is the plain one: stored bodies still match it
  });

  it('keeps both info calls as receipts: the 400 and the answer', async () => {
    const { t } = transport();
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(t) });
    const info = r.receipts.filter((x) => x.endpoint === INFO);
    expect(info.map((x) => x.httpStatus)).toEqual([400, 200]);
    expect(info[0].errorMessage).toContain("Invalid value for 'id'");
    expect(info[1].params.skip_invalid).toBe('true');
  });

  it('the rejected id stays on the page as a row without a verdict, named by its id', async () => {
    const { t } = transport();
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(t) });
    const ghost = r.wrappers.find((w) => w.cryptoId === GHOST)!;
    expect(ghost.symbol).toBe(`#${GHOST}`);
    expect(ghost.issuer).toBe('issuer not named by CMC');
    expect(ghost.verdict).toBeNull();
    expect(ghost.reason).toBe('CMC returned no daily history for this window');
  });

  it('any other 400 from info is still a failed lookup with the verbatim error (no blind retry)', async () => {
    const bad = {
      httpStatus: 400,
      body: { status: { error_code: 400, error_message: '"aux" contains an invalid value', credit_count: 0 } },
    };
    const e = (await lookup('NVDA', {
      window: 30,
      nowMs: NOW,
      allowLiveChain: false,
      rec: new Recorder(recordedTransport({ [INFO]: bad })),
    }).catch((x) => x)) as LookupFailure;
    expect(e).toBeInstanceOf(LookupFailure);
    expect(e.httpStatus).toBe(502);
    expect((e.extra.receipts as { endpoint: string }[]).filter((x) => x.endpoint === INFO)).toHaveLength(1);
  });
});

describe('wrappersOf: keyed by rwa_id, never "the first row"', () => {
  it('refuses a response that does not carry the requested rwa_id', async () => {
    const rec = new Recorder(recordedTransport()); // the recorded body is rwa_id 2 (NVDA)
    await expect(wrappersOf(rec, 3)).rejects.toThrow(/no rwa_assets row for rwa_id 3/);
  });

  it('accepts the id as a number or a numeric string', async () => {
    const body = structuredClone(fixture('recorded/rwa-quotes-nvda.json').body);
    body.data.rwa_assets[0].rwa_id = '2';
    const { asset } = await wrappersOf(new Recorder(recordedTransport({ [RWA_QUOTES]: { body } })), 2);
    expect(asset.symbol).toBe('NVDA');
  });
});

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
