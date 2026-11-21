export interface LookupError {
  status: number;
  error: string;
  cmcError?: { code: number; message: string; endpoint: string; httpStatus: number; class?: string };
  suggestions?: string[];
  at?: string;
}

/** S4: the verbatim CMC error, the time, and "no verdict printed". Never a blank stamp. */
export function ErrorBanner({ e }: { e: LookupError }) {
  return (
    <div className="banner" role="alert">
      <strong>No verdict printed.</strong> {e.cmcError ? null : e.error}
      {e.cmcError ? (
        <div className="data" style={{ marginTop: 6 }}>
          CMC {e.cmcError.endpoint} → HTTP {e.cmcError.httpStatus} · status.error_code {e.cmcError.code} · “{e.cmcError.message}”
        </div>
      ) : null}
      {e.suggestions?.length ? (
        <div style={{ marginTop: 6 }}>
          Nearest underlyings:{' '}
          {e.suggestions.map((s, i) => (
            <span key={s}>
              {i ? ', ' : ''}
              <a href={`/u/${encodeURIComponent(s)}`}>{s}</a>
            </span>
          ))}
        </div>
      ) : null}
      <div className="capture" style={{ marginTop: 6 }}>
        {e.at ? `${e.at.slice(0, 16).replace('T', ' ')} UTC` : null}
      </div>
    </div>
  );
}
