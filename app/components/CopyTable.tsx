'use client';
import { useState } from 'react';

/** Copies the table as TSV with its capture line on top (Mira's Monday note). */
export function CopyTable({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn quiet"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? 'Copied' : 'Copy table (TSV)'}
    </button>
  );
}
