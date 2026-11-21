'use client';
import { useEffect, useRef, useState } from 'react';
import type { Receipt } from '@/lib/types';

const MAX_LINES = 40;

/** Every external call of one lookup, in order: endpoint, params, HTTP, credit_count, elapsed, verbatim body, curl. */
export function ReceiptDrawer({ receipts, credits, onClose }: { receipts: Receipt[]; credits: number; onClose: () => void }) {
  const cmc = receipts.filter((r) => r.kind === 'cmc');
  const rpc = receipts.filter((r) => r.kind === 'rpc');
  const tabs = [...cmc, ...(rpc.length ? [rpcSummary(rpc)] : [])];
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const r = tabs[i];
  const json = r ? JSON.stringify(r.body, null, 2) : '';
  const lines = json.split('\n');
  const shown = full
    ? json
    : lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n… ${lines.length - MAX_LINES} more lines` : '');
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Receipts">
        <header>
          <h2>Receipts</h2>
          <span className="capture">
            {(() => {
              const live = cmc.filter((x) => !x.stored);
              const stored = cmc.length - live.length;
              const refused = live.filter((x) => (x.errorCode ?? 0) !== 0 || x.httpStatus !== 200).length;
              if (!live.length) return `${stored} recorded CMC responses, replayed (no CMC call, 0 credits)`;
              return `${live.length} CMC calls${refused ? ` (${refused} refused)` : ''}${stored ? ` · ${stored} stored bodies` : ''} · ${credits} credits charged`;
            })()}{' '}
            · {rpc.length ? `${rpc.length} live chain reads` : 'chain values from the committed baseline'}
          </span>
          <button ref={closeRef} className="btn quiet" onClick={onClose} aria-label="Close receipts (Esc)">
            Close
          </button>
        </header>
        <div className="tabs" role="tablist">
          {tabs.map((t, k) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={k === i}
              onClick={() => {
                setI(k);
                setFull(false);
              }}
            >
              {t.kind === 'cmc'
                ? t.endpoint
                    .replace(/^\/v\d\//, '')
                    .replace('cryptocurrency/', '')
                    .replace('real-world-assets/', 'rwa/')
                : 'chain reads'}
            </button>
          ))}
        </div>
        {r ? (
          <div className="body">
            {r.kind === 'cmc' ? (
              <p className="meta">
                GET {r.endpoint}
                <br />
                params {JSON.stringify(r.params)}
                <br />
                {r.stored
                  ? `stored: CMC body captured ${r.startedUtc}, committed at ${r.stored.file}${
                      cmc.some((x) => !x.stored && x.endpoint === r.endpoint && ((x.errorCode ?? 0) !== 0 || x.httpStatus !== 200))
                        ? ' (answers the refused call above)'
                        : ' (recorded replay)'
                    }`
                  : `HTTP ${r.httpStatus} · credit_count ${r.creditCount ?? 0} · error_code ${r.errorCode ?? 0} · ${r.elapsedMs} ms · ${r.startedUtc}`}
              </p>
            ) : (
              <p className="meta">{r.params.label}</p>
            )}
            <pre>{shown}</pre>
            {lines.length > MAX_LINES ? (
              <button className="btn quiet" onClick={() => setFull((f) => !f)}>
                {full ? 'Collapse' : `Show all ${lines.length} lines`}
              </button>
            ) : null}
            {r.curl ? (
              <>
                <p className="meta" style={{ marginTop: 14 }}>
                  Reproduce (your own key in $CMC_API_KEY):
                </p>
                <pre className="curl">{r.curl}</pre>
              </>
            ) : null}
          </div>
        ) : (
          <div className="body">No calls recorded.</div>
        )}
      </aside>
    </>
  );
}

/** Chain reads are many small calls; the drawer shows them as one table-like JSON with block + raw hex + explorer link. */
function rpcSummary(rpc: Receipt[]): Receipt {
  return {
    id: 'rpc-all',
    kind: 'rpc',
    endpoint: 'chain reads',
    params: {
      label: `${rpc.length} eth_call reads (totalSupply 0x18160ddd at day-boundary blocks, live tail beyond the committed baseline)`,
    },
    startedUtc: rpc[0].startedUtc,
    elapsedMs: rpc.reduce((s, r) => Math.max(s, r.elapsedMs), 0),
    httpStatus: 200,
    bodyBytes: 0,
    body: rpc.map((r) => ({ call: r.endpoint, token: r.params.to, block: r.block, raw: r.body, explorer: r.explorerUrl })),
  };
}
