/**
 * One recorder per lookup. Every external call (CMC + RPC) goes through it, so the receipt
 * drawer, `npm run demo` and `npm run snapshot` all show the same verbatim record.
 * The CMC key travels in a header and the Alchemy key in a URL path; neither is ever recorded.
 */
import { CMC_BASE, cmcErrorCode, cmcFetch, type CmcCall } from './cmc/client';
import { classifyCmcError } from './cmc/errors';
import { EXPLORER, RPC_REQUEST, rpcBatch, type ChainId, type RpcReq } from './chain/rpc';
import type { StoredLookup } from './stored';
import type { Receipt } from './types';

/** One refused live call answered from a committed body (the live-stored path). */
export interface Fallback {
  endpoint: string;
  file: string;
  capturedUtc: string;
  storedParams: Record<string, string>;
  liveError: { code: number; message: string; httpStatus: number };
  body: unknown;
}

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
  /** live calls refused with an ENTITLEMENT error and answered from a stored body (empty on a fully live run) */
  readonly fallbacks: Fallback[] = [];
  /** full redacted bodies of receipts the drawer cap truncated (written to evidence/ by the capture scripts) */
  private readonly fullBodies = new Map<string, unknown>();
  private n = 0;
  /**
   * @param cmcTransport test hook: replace the CMC transport
   * @param stored when set, a call CMC refuses with a classified entitlement error (plan / credits, never a 5xx,
   *   timeout or rate limit) is answered from this store and both receipts are kept. Unset in every capture script.
   */
  constructor(
    private readonly cmcTransport: typeof cmcFetch = cmcFetch,
    private readonly rpcTransport: typeof rpcBatch = rpcBatch,
    private readonly stored: StoredLookup | null = null,
  ) {}

  get credits(): number {
    return this.receipts.reduce((s, r) => s + (r.creditCount ?? 0), 0);
  }

  /** the body to archive under evidence/: the full redacted body, never the drawer's truncation marker */
  archiveBody(r: Receipt): unknown {
    return this.fullBodies.get(r.id) ?? r.body;
  }

  get storedEnabled(): boolean {
    return this.stored !== null;
  }

  private record(call: CmcCall<unknown>, stored?: Receipt['stored']): void {
    const text = redact(typeof call.body === 'string' ? call.body : JSON.stringify(call.body));
    const bodyBytes = Buffer.byteLength(text);
    const id = `r${++this.n}`;
    if (bodyBytes > BODY_CAP_BYTES) this.fullBodies.set(id, redactDeep(call.body));
    this.receipts.push({
      id,
      kind: 'cmc',
      endpoint: call.endpoint,
      params: call.params,
      startedUtc: call.startedUtc,
      elapsedMs: call.elapsedMs,
      httpStatus: call.httpStatus,
      creditCount: stored ? 0 : (call.status?.credit_count ?? 0),
      errorCode: cmcErrorCode(call.status),
      errorMessage: call.status?.error_message != null ? redact(String(call.status.error_message)) : null,
      body: bodyBytes <= BODY_CAP_BYTES ? JSON.parse(JSON.stringify(redactDeep(call.body))) : { truncated: true, bodyBytes },
      bodyBytes,
      curl: curlFor(call.endpoint, call.params),
      ...(stored ? { stored } : {}),
    });
  }

  async cmc<T = unknown>(endpoint: string, params: Record<string, string>): Promise<CmcCall<T>> {
    let call: CmcCall<T>;
    try {
      call = await this.cmcTransport<T>(endpoint, params);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (/CMC_API_KEY is not set/.test(msg)) throw e; // configuration, not a network failure
      // timeout / DNS / reset: keep a receipt; httpStatus 0 classifies as transient (a failed run, never a fallback)
      call = {
        endpoint,
        params,
        method: 'GET',
        httpStatus: 0,
        ok: false,
        startedUtc: new Date().toISOString(),
        elapsedMs: 0,
        status: { error_code: 0, error_message: redact(`transport error: ${(e as Error)?.name ?? 'Error'}: ${msg}`) },
        body: { transportError: redact(msg) } as T,
      };
    }
    this.record(call, call.stored);
    if (call.ok || !this.stored) return call;
    const code = cmcErrorCode(call.status);
    if (classifyCmcError(code, call.httpStatus) !== 'entitlement') return call;
    const s = this.stored(endpoint, params);
    if (!s) return call;
    const status = (s.body as { status?: CmcCall['status'] } | null)?.status ?? null;
    this.fallbacks.push({
      endpoint,
      file: s.file,
      capturedUtc: s.capturedUtc,
      storedParams: s.params,
      liveError: { code, message: redact(String(call.status?.error_message ?? '')), httpStatus: call.httpStatus },
      body: s.body,
    });
    const answered: CmcCall<T> = {
      endpoint,
      params: s.params,
      method: 'GET',
      httpStatus: 200,
      ok: true,
      startedUtc: s.capturedUtc,
      elapsedMs: 0,
      status,
      body: s.body as T,
    };
    this.record(answered, { file: s.file, capturedUtc: s.capturedUtc });
    return answered;
  }

  /** One JSON-RPC batch; each request gets its own receipt (method, block, raw hex result, explorer link). */
  async rpc<T = string>(chain: ChainId, reqs: RpcReq[], meta: { label?: string; address?: string; deadline?: number } = {}): Promise<T[]> {
    const startedUtc = new Date().toISOString();
    const t0 = performance.now();
    let results: T[] | null = null;
    let err: unknown = null;
    try {
      results = await this.rpcTransport<T>(
        chain,
        reqs,
        meta.deadline === undefined ? undefined : { ...RPC_REQUEST, deadline: meta.deadline },
      );
    } catch (e) {
      err = e;
    }
    const elapsedMs = Math.round(performance.now() - t0);
    reqs.forEach((r, i) => {
      const blockHex = r.params[1];
      const block = typeof blockHex === 'string' && blockHex.startsWith('0x') ? parseInt(blockHex, 16) : undefined;
      const to = (r.params[0] as { to?: string } | undefined)?.to ?? meta.address;
      const body = results ? results[i] : { error: redact(String((err as Error)?.message ?? err)) };
      const text = JSON.stringify(body);
      this.receipts.push({
        id: `r${++this.n}`,
        kind: 'rpc',
        endpoint: `${chain}:${r.method}`,
        params: {
          to: String(to ?? ''),
          data: String((r.params[0] as { data?: string } | undefined)?.data ?? ''),
          block: String(block ?? blockHex ?? ''),
          ...(meta.label ? { label: meta.label } : {}),
        },
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
