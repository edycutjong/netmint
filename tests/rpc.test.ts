import { describe, expect, it } from 'vitest';
import { chainFromPlatform, scaleUnits, totalSupplyReq, hex, isRevert, RpcError } from '@/lib/chain/rpc';
import { cmcErrorCode } from '@/lib/cmc/client';

describe('chain helpers', () => {
  it('maps CMC platform names to the two verifiable chains only', () => {
    expect(chainFromPlatform('Ethereum')).toBe('eth');
    expect(chainFromPlatform('BNB Smart Chain (BEP20)')).toBe('bsc');
    expect(chainFromPlatform('Solana')).toBeNull();
    expect(chainFromPlatform('Arbitrum')).toBeNull();
    expect(chainFromPlatform(undefined)).toBeNull();
  });

  it('scales uint256 totalSupply by decimals without losing whole units', () => {
    expect(scaleUnits('0x' + (1_548_560n * 10n ** 18n + 5n * 10n ** 17n).toString(16), 18)).toBe(1_548_560.5);
    expect(scaleUnits('0x0', 18)).toBe(0);
    expect(() => scaleUnits('0x', 8)).toThrow(/empty eth_call/);
  });

  it('tells a reverted call from a transport failure', () => {
    expect(isRevert(new RpcError('bsc RPC: execution reverted', 3))).toBe(true);
    expect(isRevert(new RpcError('bsc RPC HTTP 429'))).toBe(false);
    expect(isRevert(new Error('fetch failed'))).toBe(false);
  });

  it('builds a totalSupply eth_call at a hex block', () => {
    expect(totalSupplyReq('0xabc', 133252160)).toEqual({ method: 'eth_call', params: [{ to: '0xabc', data: '0x18160ddd' }, hex(133252160)] });
    expect(totalSupplyReq('0xabc', 'latest').params[1]).toBe('latest');
  });
});

describe('cmcErrorCode', () => {
  it('reads numeric and string error codes (v5 sends strings)', () => {
    expect(cmcErrorCode({ error_code: 0 })).toBe(0);
    expect(cmcErrorCode({ error_code: '4001' })).toBe(4001);
    expect(cmcErrorCode({ error_code: 1006 })).toBe(1006);
    expect(cmcErrorCode(null)).toBe(0);
    expect(cmcErrorCode({ error_code: 'x' })).toBe(-1);
  });
});

describe('rpcBatch under a compute-units-per-second limit', () => {
  it('keeps answered entries and re-sends only the rate-limited ones', async () => {
    const { rpcBatch } = await import('@/lib/chain/rpc');
    const sent: number[][] = [];
    const real = globalThis.fetch;
    process.env.ALCHEMY_API_KEY ??= 'test-key-not-real';
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { id: number }[];
      sent.push(body.map((b) => b.id));
      const first = sent.length === 1;
      const out = body.map((b) => (first && b.id % 2 ? { id: b.id, error: { code: 429, message: 'exceeded its compute units per second capacity' } } : { id: b.id, result: `0x${b.id.toString(16)}` }));
      return new Response(JSON.stringify(out), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const reqs = Array.from({ length: 6 }, () => ({ method: 'eth_call', params: [{ to: '0x1', data: '0x' }, 'latest'] }));
      const res = await rpcBatch('eth', reqs, { timeoutMs: 1000, maxRetries: 2 });
      expect(res).toEqual(['0x0', '0x1', '0x2', '0x3', '0x4', '0x5']);
      expect(sent).toEqual([[0, 1, 2, 3, 4, 5], [1, 3, 5]]);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('chain-read deadline', () => {
  it('past the lookup deadline every remaining read fails with a reason (never a platform 504)', async () => {
    const { legSupplies } = await import('@/lib/chain/supply');
    const { Recorder } = await import('@/lib/receipts');
    const rec = new Recorder(undefined, (async () => {
      throw new Error('no RPC may run after the deadline');
    }) as any);
    const out = await legSupplies(rec, [{ chain: 'bsc', address: '0x0000000000000000000000000000000000000001' }], ['2026-11-20'], { deadlineMs: Date.now() - 1 });
    expect(out.errors).toEqual(['bsc RPC: bsc RPC: chain-read time budget exhausted']);
    expect(out.legs[0].values.get('2026-11-20')).toBeNull();
  });
});
