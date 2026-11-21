/**
 * One recorder per lookup. Every external call (CMC + RPC) goes through it, so the receipt
 * drawer, `npm run demo` and `npm run snapshot` all show the same verbatim record.
 * The CMC key travels in a header and the Alchemy key in a URL path; neither is ever recorded.
 */
import { CMC_BASE, cmcErrorCode, cmcFetch, type CmcCall } from './cmc/client';
import { EXPLORER, rpcBatch, type ChainId, type RpcReq } from './chain/rpc';
import type { Receipt } from './types';

/** Bodies bigger than this are kept in the receipt only as a byte count + summary (drawer payload cap). */
export const BODY_CAP_BYTES = 400_000;

export function curlFor(endpoint: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `curl -s -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "${CMC_BASE}${endpoint}${qs ? `?${qs}` : ''}"`;
}

/** Remove any secret value from a string (defence in depth; keys are never put into bodies). */
export function redact(text: string, secrets = [process.env.CMC_API_KEY, process.env.ALCHEMY_API_KEY]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[REDACTED]');
  return out;
}

export class Recorder {
  readonly receipts: Receipt[] = [];
  private n = 0;
  /** test hook: replace the CMC transport */
  constructor(
    private readonly cmcTransport: typeof cmcFetch = cmcFetch,
    private readonly rpcTransport: typeof rpcBatch = rpcBatch,
  ) {}

  get credits(): number {
    return this.receipts.reduce((s, r) => s + (r.creditCount ?? 0), 0);
  }

  async cmc<T = unknown>(endpoint: string, params: Record<string, string>): Promise<CmcCall<T>> {
    const call = await this.cmcTransport<T>(endpoint, params);
    const text = redact(typeof call.body === 'string' ? call.body : JSON.stringify(call.body));
    const bodyBytes = Buffer.byteLength(text);
    this.receipts.push({
      id: `r${++this.n}`,
      kind: 'cmc',
      endpoint,
      params,
      startedUtc: call.startedUtc,
      elapsedMs: call.elapsedMs,
      httpStatus: call.httpStatus,
      creditCount: call.status?.credit_count ?? 0,
      errorCode: cmcErrorCode(call.status),
      errorMessage: call.status?.error_message ?? null,
      body: bodyBytes <= BODY_CAP_BYTES ? JSON.parse(JSON.stringify(redactDeep(call.body))) : { truncated: true, bodyBytes },
      bodyBytes,
      curl: curlFor(endpoint, params),
    });
    return call;
  }

  /** One JSON-RPC batch; each request gets its own receipt (method, block, raw hex result, explorer link). */
  async rpc<T = string>(chain: ChainId, reqs: RpcReq[], meta: { label?: string; address?: string } = {}): Promise<T[]> {
    const startedUtc = new Date().toISOString();
    const t0 = performance.now();
    let results: T[] | null = null;
    let err: unknown = null;
    try {
      results = await this.rpcTransport<T>(chain, reqs);
    } catch (e) {
      err = e;
    }
    const elapsedMs = Math.round(performance.now() - t0);
    reqs.forEach((r, i) => {
      const blockHex = r.params[1];
      const block = typeof blockHex === 'string' && blockHex.startsWith('0x') ? parseInt(blockHex, 16) : undefined;
      const to = (r.params[0] as { to?: string } | undefined)?.to ?? meta.address;
      const body = results ? results[i] : { error: String((err as Error)?.message ?? err) };
      const text = JSON.stringify(body);
      this.receipts.push({
        id: `r${++this.n}`,
        kind: 'rpc',
        endpoint: `${chain}:${r.method}`,
        params: { to: String(to ?? ''), data: String((r.params[0] as { data?: string } | undefined)?.data ?? ''), block: String(block ?? blockHex ?? '') , ...(meta.label ? { label: meta.label } : {}) },
        startedUtc,
        elapsedMs,
        httpStatus: err ? 0 : 200,
        body,
        bodyBytes: Buffer.byteLength(text),
        chain,
        block,
        explorerUrl: to ? `${EXPLORER[chain]}/token/${to}` : undefined,
      });
    });
    if (err) throw err;
    return results as T[];
  }
}

function redactDeep(v: unknown): unknown {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}
