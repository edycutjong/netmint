/** Regression tests for the second architecture review of 2026-11-28: what a wrapper is told when one of its inputs is missing. */
import { describe, expect, it } from 'vitest';
import type { CmcCall } from '@/lib/cmc/client';
import { RpcEntryError, SEL, type ChainId, type RpcEntry, type RpcReq } from '@/lib/chain/rpc';
import { interiorHoles, sanityGuard } from '@/lib/flow/sanity';
import { lookup, heroOf } from '@/lib/lookup';
import { Recorder } from '@/lib/receipts';
import { findStored, storedTransport, storeFrom, type StoredBody } from '@/lib/stored';
import { fixture, NOW, raw, recordedTransport } from './helpers';

const HIST = '/v2/cryptocurrency/quotes/historical';
const INFO = '/v2/cryptocurrency/info';
const RWA_QUOTES = '/v5/real-world-assets/quotes/latest';
const NVDAB = 40215; // one leg, BNB Chain
const GHOST = 39002; // the id CMC listed under HOOD with no symbol, issuer or market cap (2026-11-27)
const PLAN = {
  httpStatus: 403,
  body: { status: { error_code: 1006, error_message: "Your API Key subscription plan doesn't support this endpoint.", credit_count: 0 } },
};
const asStored = (name: string): StoredBody => {
  const f = fixture(`recorded/${name}.json`);
  return {
    endpoint: f.receipt.endpoint,
    params: f.receipt.params,
    capturedUtc: f.receipt.startedUtc,
    file: `tests/fixtures/recorded/${name}.json`,
    body: f.body,
  };
};
const BODIES = ['hist-nvda-wrappers-30d', 'rwa-quotes-nvda', 'quotes-latest-nvda', 'info-nvda-wrappers', 'rwa-assets-list-p1'].map(
  asStored,
);
const plain = () => lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec: new Recorder(recordedTransport()) });

describe('a listed contract that gives no usable decimals() on the click', () => {
  const DEAD = `0x${'d'.repeat(40)}`;
  // NVDAB's contract is swapped for an address with no committed baseline, so its window is read live
  const infoWithDeadLeg = () => {
    const body = structuredClone(fixture('recorded/info-nvda-wrappers.json').body);
    body.data[NVDAB].contract_address[0].contract_address = DEAD;
    return { body };
  };
  // what Alchemy answers for a reverted eth_call inside a batch (docs/proof/spike/rpc-batch-revert.json)
  const reverting = async <T>(chain: ChainId, reqs: RpcReq[]): Promise<T[]> => {
    const entries: RpcEntry<T>[] = reqs.map((r) => {
      const call = r.params[0] as { to: string; data: string };
      if (call.to === DEAD) return { error: { code: 3, message: 'execution reverted' } };
      return { result: (call.data === SEL.decimals ? '0x12' : '0x0de0b6b3a7640000') as T };
    });
    throw new RpcEntryError(`${chain} RPC: execution reverted`, 3, entries);
  };

  it('is named in the reason, with no promise that running it again will help; the other wrappers keep their answers', async () => {
    const before = await plain();
    const rec = new Recorder(recordedTransport({ [INFO]: infoWithDeadLeg() }), reverting as never);
    const r = await lookup('NVDA', { window: 30, nowMs: NOW, rec });
    const w = r.wrappers.find((x) => x.cryptoId === NVDAB)!;
    expect(w.verdict).toBe('NOT_VERIFIABLE');
    expect(w.reason).toBe(
      `chain check unavailable: the contract CMC lists on BNB Chain (${DEAD}) returned no usable decimals(), so its supply cannot be read`,
    );
    expect(r.errors).toEqual([]); // nothing failed: the contract answered, with a revert
    // only the decimals() batch for the address without a baseline went out; no totalSupply read for a leg of unknown scale
    expect(rec.receipts.filter((x) => x.kind === 'rpc').map((x) => `${x.params.label} ${x.params.to}`)).toEqual([`decimals ${DEAD}`]);
    const same = (s: string) => [r, before].map((x) => x.wrappers.find((y) => y.symbol === s)!).map((y) => `${y.verdict} ${y.reason}`);
    for (const s of ['NVDAX', 'NVDAon', 'rNVDA']) expect(same(s)[0]).toBe(same(s)[1]);
  });
});

describe('a wrapper with daily history that /v2/cryptocurrency/info answers without', () => {
  it('is not told "no contract on a listed chain": the reason says the info answer has no entry for it', async () => {
    const body = structuredClone(fixture('recorded/info-nvda-wrappers.json').body);
    delete body.data[NVDAB];
    const r = await lookup('NVDA', {
      window: 30,
      nowMs: NOW,
      allowLiveChain: false,
      rec: new Recorder(recordedTransport({ [INFO]: { body } })),
    });
    const w = r.wrappers.find((x) => x.cryptoId === NVDAB)!;
    expect(w.verdict).toBe('NOT_VERIFIABLE');
    expect(w.reason).toBe("CMC's /v2/cryptocurrency/info answer has no entry for this id, so there is no contract to check on chain");
    expect(w.metrics).not.toBeNull(); // CMC's supply change × price is still shown, unproven
    // a wrapper CMC does list with contracts on other chains keeps the sentence about those chains
    expect(r.wrappers.find((x) => x.symbol === 'rNVDA')!.reason).toMatch(/^no contract on BNB Chain or Ethereum \(listed on Arbitrum\)/);
  });
});

describe('history provenance of a live-stored answer', () => {
  const store = storeFrom(BODIES, { partial: true });
  const click = (over: Record<string, unknown>) =>
    lookup('NVDA', {
      window: 30,
      nowMs: NOW,
      allowLiveChain: false,
      rec: new Recorder(recordedTransport(over as never), undefined, store),
    });

  it('says "stored" only when quotes/historical itself was answered from a stored body', async () => {
    const info = await click({ [INFO]: PLAN });
    expect(info.mode).toBe('live-stored');
    expect(info.stored!.map((s) => s.endpoint)).toEqual([INFO]);
    expect(info.liveCmcCalls).toContain(HIST);
    expect(info.history).toBeUndefined(); // the daily history was read live on this click
    const hist = await click({ [HIST]: PLAN });
    expect(hist.history).toEqual({ source: 'stored', lastDay: '2026-11-21', capturedUtc: '2026-11-21T01:40:10.925Z' });
  });
});

describe('skip_invalid is not part of what a stored info body answers', () => {
  // CMC's measured behaviour for the HOOD ghost id: the plain multi-id info call is a 400, skip_invalid=true answers the rest
  const ghostTransport = () => {
    const rwa = structuredClone(fixture('recorded/rwa-quotes-nvda.json').body);
    rwa.data.rwa_assets[0].tokens.push({ crypto_id: GHOST, symbol: null, name: null, issuer_name: null, market_cap: null });
    const base = recordedTransport({ [RWA_QUOTES]: { body: rwa } });
    return async <T>(endpoint: string, params: Record<string, string> = {}): Promise<CmcCall<T>> => {
      if (endpoint !== INFO || params.skip_invalid === 'true') return base<T>(endpoint, params);
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
  };

  it('a capture that went through the retry replays from its own stored bodies (the refresh of a ticker with a ghost id)', async () => {
    const rec = new Recorder(ghostTransport());
    const captured = await lookup('NVDA', { window: 30, nowMs: NOW, allowLiveChain: false, rec });
    // what every capture script writes and loadStoredIndex reads back: the successful CMC bodies only (the 400 is not one)
    const stored: StoredBody[] = rec.receipts
      .filter((x) => x.kind === 'cmc' && x.httpStatus === 200 && (x.errorCode ?? 0) === 0)
      .map((x, i) => ({
        endpoint: x.endpoint,
        params: x.params,
        capturedUtc: x.startedUtc,
        file: `capture/${i}.json`,
        body: rec.archiveBody(x),
      }));
    expect(stored.find((s) => s.endpoint === INFO)!.params.skip_invalid).toBe('true');
    const replay = await lookup('NVDA', {
      from: captured.range.from,
      to: captured.range.to,
      allowLiveChain: false,
      rec: new Recorder(storedTransport(storeFrom(stored))), // strict store, as verify:flows and the recorded hero use
    });
    const [a, b] = [captured, replay].map((r) => heroOf(r).wrapper!);
    expect(`${b.symbol} ${b.verdict}`).toBe(`${a.symbol} ${a.verdict}`);
    expect(Math.abs(b.metrics!.net - a.metrics!.net)).toBeLessThan(1);
    expect(replay.wrappers.find((w) => w.cryptoId === GHOST)!.reason).toBe(captured.wrappers.find((w) => w.cryptoId === GHOST)!.reason);
  });

  it('a refused retry is still answered from a body captured by a plain call, and the ghost id is named as not held', () => {
    const info = BODIES.find((s) => s.endpoint === INFO)!;
    const ask = { ...info.params, id: `${info.params.id},${GHOST}`, skip_invalid: 'true' };
    expect(findStored(BODIES, INFO, ask)).toBeNull(); // strict: the body's request never asked for the ghost id
    const hit = findStored(BODIES, INFO, ask, { partial: true })!;
    expect(hit.file).toContain('info-nvda-wrappers');
    expect(hit.missingIds).toEqual([String(GHOST)]);
    // no other parameter is relaxed: a body captured with a different aux list does not answer
    expect(findStored([{ ...info, params: { ...info.params, aux: 'urls' } }], INFO, info.params)).toBeNull();
  });
});

describe('interiorHoles: the days inside an accepted window that have no accepted point', () => {
  it('separates the days CMC sent no row for from the days the guard refused, and ignores the edges and duplicates', () => {
    const day = (date: string, circulating_supply: number, price = 100) => ({ date, circulating_supply, price });
    const rows = raw([
      day('2026-11-01', 0), // refused before the first accepted day: an edge, not a hole
      day('2026-11-02', 1e6),
      day('2026-11-03', 1e6),
      day('2026-11-03', 1e6), // duplicate: its day has an accepted point
      // 2026-11-04 and 2026-11-05: no row
      day('2026-11-06', 1e6),
      day('2026-11-07', 1e6, 0), // refused by the guard: a price of zero
      day('2026-11-08', 1e6),
    ]);
    const { accepted, refused } = sanityGuard(rows);
    expect(accepted.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-08']);
    expect(interiorHoles(accepted, refused)).toEqual({ gaps: ['2026-11-04', '2026-11-05'], refusedDays: ['2026-11-07'] });
    expect(interiorHoles(accepted.slice(0, 1), refused)).toEqual({ gaps: [], refusedDays: [] });
  });
});
