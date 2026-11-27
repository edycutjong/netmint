/**
 * Endpoint 4: /v2/cryptocurrency/info?id= → contract_address[] per wrapper (the mint-check contract map).
 * Supported legs are BNB Smart Chain + Ethereum; every other listed chain is an unreadable leg.
 */
import { cmcErrorCode } from './client';
import { CmcError } from './errors';
import { chainFromPlatform, type ChainId } from '../chain/rpc';
import type { Recorder } from '../receipts';

export interface ContractMap {
  legs: { chain: ChainId; address: string }[];
  unreadable: string[]; // platform names we cannot read historically (Solana, Arbitrum, …)
}

export function contractMapFrom(entry: any): ContractMap {
  const legs: { chain: ChainId; address: string }[] = [];
  const unreadable: string[] = [];
  const list: any[] = entry?.contract_address ?? [];
  const items = list.length
    ? list.map((c) => ({ p: c?.platform?.name, a: c?.contract_address }))
    : entry?.platform
      ? [{ p: entry.platform.name, a: entry.platform.token_address }]
      : [];
  for (const { p, a } of items) {
    const chain = chainFromPlatform(p);
    if (chain && typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) {
      const address = a.toLowerCase();
      if (!legs.some((l) => l.chain === chain && l.address === address)) legs.push({ chain, address });
    } else if (p && !unreadable.includes(p)) unreadable.push(p);
  }
  return { legs, unreadable };
}

export async function contractMaps(rec: Recorder, ids: number[]): Promise<Map<number, ContractMap>> {
  const out = new Map<number, ContractMap>();
  if (ids.length === 0) return out;
  const params = { id: ids.join(','), aux: 'platform' };
  const ask = (p: Record<string, string>) => rec.cmc<any>('/v2/cryptocurrency/info', p);
  let call = await ask(params);
  // info answers the WHOLE multi-id call with HTTP 400 "Invalid value for 'id': '<n>'" when one id has no record, while
  // quotes/latest and quotes/historical skip such an id (measured 2026-11-27: CMC lists crypto_id 39002 under HOOD with no
  // symbol or issuer; docs/proof/spike/info-invalid-id-*.json). skip_invalid=true returns every valid id, so one ghost
  // listing never costs the other wrappers their verdict. Both calls stay in the receipts.
  if (!call.ok && call.httpStatus === 400 && /invalid value for 'id'/i.test(String(call.status?.error_message ?? ''))) {
    call = await ask({ ...params, skip_invalid: 'true' });
  }
  if (!call.ok) {
    throw new CmcError(
      call.endpoint,
      cmcErrorCode(call.status),
      call.httpStatus,
      String(call.status?.error_message ?? 'no CMC status object'),
    );
  }
  const data = call.body?.data ?? {};
  for (const e of Object.values<any>(data)) out.set(Number(e.id), contractMapFrom(e));
  return out;
}
