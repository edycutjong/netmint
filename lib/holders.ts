/**
 * Holder panel (Omnibus, cut-1 form): holder addresses per chain per wrapper of one underlying, plus the mint
 * recipient of any verified step we have a receipt for. Same recorder discipline as lookup(): every CMC call is a receipt.
 */
import { Recorder, redact } from './receipts';
import { resolveUnderlying, wrappersOf } from './cmc/rwa';
import { contractMaps } from './cmc/info';
import { holderCount, type HolderCount } from './cmc/holders';
import { CmcError } from './cmc/errors';
import { cachedMints, LookupFailure } from './lookup';
import type { MintReceipt, Receipt } from './types';

export interface HolderRow {
  cryptoId: number;
  symbol: string;
  issuer: string;
  legs: HolderCount[];
  unreadable: string[]; // chains the holder endpoint cannot be asked about from this contract map (Solana, L2s…)
  total: number | null; // sum over the readable legs; null when no leg answered
  mintRecipient: MintReceipt | null;
}

export interface HoldersResult {
  underlying: { rwaId: number; ticker: string; name: string };
  fetchedUtc: string;
  rows: HolderRow[];
  receipts: Receipt[];
  credits: number;
  elapsedMs: number;
}

export function mintRecipientOf(cryptoId: number, mints = cachedMints()): MintReceipt | null {
  const mine = mints.filter((m) => m.crypto_id === cryptoId);
  return mine.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

export function sumHolders(legs: HolderCount[]): number | null {
  const ok = legs.filter((l) => l.count !== null);
  return ok.length ? ok.reduce((s, l) => s + (l.count as number), 0) : null;
}

export async function holders(u: string, opts: { rec?: Recorder } = {}): Promise<HoldersResult> {
  const t0 = performance.now();
  const rec = opts.rec ?? new Recorder();
  try {
    const { asset } = await resolveUnderlying(rec, u);
    if (!asset) throw new LookupFailure(404, `No tokenised wrappers on CMC for '${u}'`, { receipts: rec.receipts, credits: rec.credits });
    const { asset: full, tokens } = await wrappersOf(rec, asset.rwa_id);
    const live = tokens.filter((t) => !t.derivative);
    const maps = await contractMaps(
      rec,
      live.map((t) => t.crypto_id),
    );
    const rows: HolderRow[] = [];
    for (const t of live) {
      const map = maps.get(t.crypto_id) ?? { legs: [], unreadable: [] };
      const legs = await Promise.all(map.legs.map((l) => holderCount(rec, l.chain, l.address)));
      rows.push({
        cryptoId: t.crypto_id,
        symbol: t.symbol,
        issuer: t.issuer_name,
        legs,
        unreadable: map.unreadable,
        total: sumHolders(legs),
        mintRecipient: mintRecipientOf(t.crypto_id),
      });
    }
    rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
    return {
      underlying: { rwaId: full.rwa_id, ticker: full.symbol, name: full.name },
      fetchedUtc: new Date().toISOString(),
      rows,
      receipts: rec.receipts,
      credits: rec.credits,
      elapsedMs: Math.round(performance.now() - t0),
    };
  } catch (e) {
    if (e instanceof LookupFailure) throw e;
    if (e instanceof CmcError)
      throw new LookupFailure(e.kind === 'transient' ? 503 : 502, redact(e.message), { receipts: rec.receipts, credits: rec.credits });
    throw new LookupFailure(500, redact(`holders failed: ${(e as Error)?.message ?? String(e)}`), {
      receipts: rec.receipts,
      credits: rec.credits,
    });
  }
}
