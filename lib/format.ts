/** Display formatting shared by the pages, the demo and the Cite line. Proper minus signs. */
import type { Verdict } from './types';

const M = '−';
export const usd = (x: number, dp = 1): string => {
  const a = Math.abs(x);
  const s =
    a >= 1e9
      ? `$${(a / 1e9).toFixed(dp)}B`
      : a >= 1e6
        ? `$${(a / 1e6).toFixed(dp)}M`
        : a >= 1e3
          ? `$${(a / 1e3).toFixed(0)}k`
          : `$${a.toFixed(0)}`;
  return `${x < 0 ? M : '+'}${s}`;
};
export const units = (x: number): string => `${x < 0 ? M : '+'}${Math.round(Math.abs(x)).toLocaleString('en-US')}`;
export const plain = (x: number): string => Math.round(x).toLocaleString('en-US');
export const pct = (x: number, dp = 1): string => `${x < 0 ? M : '+'}${Math.abs(x * 100).toFixed(dp)}%`;
export const times = (x: number): string => `×${x >= 10 ? x.toFixed(1) : x.toFixed(2)}`;
export const short = (h: string, a = 6, b = 5): string => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);
export const VERDICT_LABEL: Record<Verdict, string> = {
  REAL_INFLOW: 'REAL INFLOW',
  OUTFLOW: 'OUTFLOW',
  RECOUNT: 'RECOUNT',
  NOT_VERIFIABLE: 'NOT VERIFIABLE',
  FLAT: 'FLAT',
};
export const utcStamp = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
