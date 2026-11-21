/**
 * Endpoint 8: /v1/dex/holders/count?platform=&tokenAddress= (1 credit) — holder addresses of one token on one chain.
 * Platform names are CMC's: `ethereum` and `bsc` ("eth" is rejected with 400, measured 2026-11-21).
 * /v1/dex/holders/list is NOT used: no accepted request body was found in P1a (docs/proof/spike/summary.json).
 */
import { cmcErrorCode } from './client';
import type { Recorder } from '../receipts';
import type { ChainId } from '../chain/rpc';

export const HOLDER_PLATFORM: Record<ChainId, string> = { bsc: 'bsc', eth: 'ethereum' };

export interface HolderCount {
  chain: ChainId;
  address: string;
  count: number | null;
  error: string | null;
}

export async function holderCount(rec: Recorder, chain: ChainId, address: string): Promise<HolderCount> {
  const call = await rec.cmc<any>('/v1/dex/holders/count', { platform: HOLDER_PLATFORM[chain], tokenAddress: address });
  const n = Number(call.body?.data?.count);
  if (call.ok && Number.isFinite(n) && n >= 0) return { chain, address, count: n, error: null };
  const msg = call.status?.error_message ?? 'no CMC status object';
  return { chain, address, count: null, error: `CMC error ${cmcErrorCode(call.status)}: ${String(msg).slice(0, 160)}` };
}
