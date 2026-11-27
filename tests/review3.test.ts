/** Regression tests for the architecture review of 2026-11-28 (what the live rail tickers and a fresh read turned up). */
import { describe, expect, it } from 'vitest';
import type { CmcCall } from '@/lib/cmc/client';
import { addDays, isUtcDay } from '@/lib/cmc/history';
import { wrappersOf } from '@/lib/cmc/rwa';
import { decideVerdict } from '@/lib/flow/verdict';
import { evaluateWrapper, lookup, LookupFailure, heroOf } from '@/lib/lookup';
import { parseLookupParams } from '@/lib/lookupParams';
import { Recorder } from '@/lib/receipts';
import type { WrapperResult } from '@/lib/types';
import { check, fixture, mirrorChain, NOW, recordedTransport, series } from './helpers';

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

describe('the trial behind a proof row', () => {
  it('each step day carries the CMC days its sum ran over: three days inside the window, fewer at its edge', () => {
    const s = series([1e6, 1e6, 1e6, 1e6, 1.5e6, 1.5e6, 1.5e6, 1.5e6, 2e6], 100); // moves land on 11-05 and on the last day, 11-09
    const { mint } = check(s, mirrorChain(s));
    expect(mint.status).toBe('pass');
    expect(mint.stepDays.find((d) => d.date === '2026-11-05')!.span).toEqual(['2026-11-03', '2026-11-06']);
    expect(mint.stepDays.find((d) => d.date === '2026-11-09')!.span).toEqual(['2026-11-07', '2026-11-09']); // clamped: no day after B
  });

  it('an ambiguous alignment says what was re-tried at the other offset: the window and its direction, not the step days', () => {
    const s = series([1e6, 1e6, 1e6, 1.85e6, 1.85e6, 1.85e6, 2e6], 100);
    const { metrics, mint } = check(s, mirrorChain(s, 1, 1), { offset: 0 });
    expect(mint.status).toBe('ambiguous');
    expect(decideVerdict(metrics, mint).reason).toBe(
      'endpoint alignment ambiguous: fails at d = 0 (issuer offset); the window and its direction pass at d = 1',
    );
  });
});

describe('a day the sanity guard refused inside a verified window', () => {
  const START = '2026-11-10';
  const sup = [1e6, 1e6, 3e6, 1e6, 1e6, 1.5e6, 1.5e6]; // 11-12 is a spike that reverts the next day; the real move lands on 11-15
  const rows = sup.map((v, i) => ({
    timestamp: `${addDays(START, i)}T00:00:00.000Z`,
    price: 150,
    circulating_supply: v,
    total_supply: v,
    volume_24h: 1,
    market_cap: v * 150,
  }));
  const chain = [1e6, 1e6, 1e6, 1e6, 1e6, 1.5e6, 1.5e6]; // the chain never saw the spike
  const leg = {
    chain: 'bsc' as const,
    address: '0xabc',
    decimals: 18,
    source: 'baseline' as const,
    baselineUtc: null,
    values: new Map(
      Array.from({ length: chain.length + 6 }, (_, i) => [addDays(START, i - 3), chain[Math.min(Math.max(i - 3, 0), chain.length - 1)]]),
    ),
    blocks: new Map<string, number | null>(),
  };
  const base: WrapperResult = {
    cryptoId: 1,
    symbol: 'TEST',
    name: 'x',
    issuer: 'bStocks',
    chains: ['BNB Chain'],
    derivative: false,
    marketCap: null,
    exitRatio: null,
    metrics: null,
    series: [],
    refused: [],
    mint: null,
    verdict: null,
    reason: '',
  };

  it('is named beside the stamp, not only in the row detail', () => {
    const w = evaluateWrapper(base, rows, { legs: [{ chain: 'bsc', address: '0xabc' }], unreadable: [] }, [leg]);
    expect(w.refused.map((r) => `${r.reason} ${r.date}`)).toEqual(['spike_revert 2026-11-12']);
    expect(w.verdict).toBe('REAL_INFLOW');
    expect(w.reason).toContain(
      "· 1 CMC day inside the window refused by the sanity guard (2026-11-12): the supply move is chain-verified, the dollars across it use the neighbouring days' average price",
    );
  });
});
