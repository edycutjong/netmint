/**
 * The live tail of lib/chain/supply.ts and the request-path retry budget of lib/chain/rpc.ts, with no network:
 * a tiny "committed" data set in a temp directory stands in for data/, and the RPC transport is a function.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RpcError, RPC_REQUEST, SEL, rpcBatch, type ChainId, type RpcReq } from '@/lib/chain/rpc';
import { Recorder } from '@/lib/receipts';

const BASELINED = `0x${'a'.repeat(40)}`;
const FRESH = `0x${'b'.repeat(40)}`;
const NO_CODE = `0x${'c'.repeat(40)}`;
const DAYS = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
const BLOCK = Object.fromEntries(DAYS.map((d, i) => [d, 1000 + i]));
const units = (n: number) => `0x${(BigInt(n) * 10n ** 18n).toString(16)}`;

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'netmint-chain-'));
  mkdirSync(path.join(dir, 'data/blocks'), { recursive: true });
  mkdirSync(path.join(dir, 'data/chain-supply/bsc'), { recursive: true });
  writeFileSync(path.join(dir, 'data/blocks/bsc.json'), JSON.stringify({ days: BLOCK }));
  writeFileSync(path.join(dir, 'data/blocks/eth.json'), JSON.stringify({ days: {} }));
  // one leg has a committed baseline for the first two days only: the last two are its live tail
  writeFileSync(
    path.join(dir, `data/chain-supply/bsc/${BASELINED}.json`),
    JSON.stringify({
      chain: 'bsc',
      address: BASELINED,
      decimals: 18,
      generated_utc: '2026-11-19T03:00:00Z',
      days: { [DAYS[0]]: 100, [DAYS[1]]: 110 },
    }),
  );
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** An RPC transport that answers decimals() and totalSupply() per address; `sent` keeps every request it saw. */
function fakeRpc(over: { fail?: Error } = {}) {
  const sent: { to: string; data: string; block: unknown }[] = [];
  const t = async <T>(_chain: ChainId, reqs: RpcReq[]): Promise<T[]> => {
    if (over.fail) throw over.fail;
    return reqs.map((r) => {
      const call = r.params[0] as { to: string; data: string };
      sent.push({ to: call.to, data: call.data, block: r.params[1] });
      if (call.data === SEL.decimals) return (call.to === NO_CODE ? '0x' : '0x12') as T; // '0x' = no contract at that address
      return units(120 + parseInt(String(r.params[1]), 16) - 1000) as T; // 120, 121, 122, 123 by block
    });
  };
  return { t, sent };
}

describe('chain supply: the live tail', () => {
  it('a leg with a committed baseline and two live days is labelled mixed, not live', async () => {
    const { legSupplies, sourceOf } = await import('@/lib/chain/supply');
    const { t } = fakeRpc();
    const out = await legSupplies(new Recorder(undefined, t as never), [{ chain: 'bsc', address: BASELINED }], DAYS);
    expect(out.errors).toEqual([]);
    expect([...out.legs[0].values.values()]).toEqual([100, 110, 122, 123]); // two baseline days, two read live
    expect(out.legs[0].source).toBe('mixed');
    expect(sourceOf(out.legs)).toBe('mixed');
  });

  it('a leg with no baseline is labelled live', async () => {
    const { legSupplies } = await import('@/lib/chain/supply');
    const { t } = fakeRpc();
    const out = await legSupplies(new Recorder(undefined, t as never), [{ chain: 'bsc', address: FRESH }], DAYS.slice(2));
    expect(out.legs[0].source).toBe('live');
    expect(out.legs[0].decimals).toBe(18);
  });

  it('an address with no contract (decimals() returns no data) stays unknown and does not void the other legs', async () => {
    const { legSupplies } = await import('@/lib/chain/supply');
    const { t, sent } = fakeRpc();
    const out = await legSupplies(
      new Recorder(undefined, t as never),
      [
        { chain: 'bsc', address: NO_CODE },
        { chain: 'bsc', address: FRESH },
      ],
      DAYS.slice(2),
    );
    expect(out.errors).toEqual([]);
    const [bad, good] = out.legs;
    expect(bad.decimals).toBeNull();
    expect([...bad.values.values()]).toEqual([null, null]); // unknown, never scaled with a guessed 18 decimals
    expect([...good.values.values()]).toEqual([122, 123]);
    expect(sent.filter((r) => r.data === SEL.totalSupply).map((r) => r.to)).toEqual([FRESH, FRESH]); // no supply read for the dead address
  });

  it('a failed read names the chain once in its error', async () => {
    const { legSupplies } = await import('@/lib/chain/supply');
    const { t } = fakeRpc({ fail: new RpcError('bsc RPC: Your app has exceeded its compute units per second capacity', 429) });
    const out = await legSupplies(new Recorder(undefined, t as never), [{ chain: 'bsc', address: FRESH }], DAYS.slice(2));
    expect(out.errors).toEqual(['bsc RPC: Your app has exceeded its compute units per second capacity']);
    expect([...out.legs[0].values.values()]).toEqual([null, null]);
  });
});

describe('rpcBatch: the request-path budget under a compute-units-per-second cap', () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
    vi.useRealTimers();
  });
  const throttledFor = (rounds: number) => {
    let calls = 0;
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      calls++;
      const body = JSON.parse(init.body) as { id: number }[];
      const out = body.map((b) =>
        calls <= rounds
          ? { id: b.id, error: { code: 429, message: 'exceeded its compute units per second capacity' } }
          : { id: b.id, result: '0x1' },
      );
      return new Response(JSON.stringify(out), { status: 200 });
    }) as unknown as typeof fetch;
    return () => calls;
  };
  const one = [{ method: 'eth_call', params: [{ to: '0x1', data: '0x' }, 'latest'] }];

  it('rides out four throttled rounds (three retries used to give up)', async () => {
    process.env.ALCHEMY_API_KEY ??= 'test-key-not-real';
    vi.useFakeTimers();
    const calls = throttledFor(4);
    const p = rpcBatch('bsc', one, { ...RPC_REQUEST });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual(['0x1']);
    expect(calls()).toBe(5);
  });

  it('still gives up, with the provider message, when the cap never lifts', async () => {
    process.env.ALCHEMY_API_KEY ??= 'test-key-not-real';
    vi.useFakeTimers();
    const calls = throttledFor(Infinity);
    const p = rpcBatch('bsc', one, { ...RPC_REQUEST }).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(((await p) as Error).message).toMatch(/compute units per second/);
    expect(calls()).toBe(RPC_REQUEST.maxRetries + 1);
  });

  it('never waits past the chain-read deadline', async () => {
    process.env.ALCHEMY_API_KEY ??= 'test-key-not-real';
    vi.useFakeTimers(); // the clock is faked too, so the elapsed time below is exact and does not depend on machine load
    throttledFor(Infinity);
    const t0 = Date.now();
    const p = rpcBatch('bsc', one, { ...RPC_REQUEST, deadline: t0 + 120 }).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(((await p) as Error).message).toMatch(/chain-read time budget exhausted/);
    expect(Date.now() - t0).toBe(120); // the one wait was the 120 ms left, not the 500 ms backoff step
  });
});
