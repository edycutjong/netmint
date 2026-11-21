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
