/**
 * CMC error classification (codes measured in P1a, docs/proof/spike/plan-errors.json).
 * entitlement → a plan/credit refusal (the 10 Dec revert path); transient → a failed run, never a revert;
 * config → our fault (bad key / bad params) → 502.
 */
export type CmcErrorClass = 'entitlement' | 'transient' | 'config' | 'other';

export const ENTITLEMENT_CODES = [1003, 1004, 1006, 1007, 1010] as const;
export const TRANSIENT_CODES = [1008, 1009, 1011] as const;
export const CONFIG_CODES = [1001, 1002, 1005] as const;

export function classifyCmcError(code: number, httpStatus: number): CmcErrorClass {
  if ((ENTITLEMENT_CODES as readonly number[]).includes(code)) return 'entitlement';
  if ((TRANSIENT_CODES as readonly number[]).includes(code)) return 'transient';
  if ((CONFIG_CODES as readonly number[]).includes(code)) return 'config';
  if (httpStatus >= 500 || httpStatus === 0 || httpStatus === 429) return 'transient';
  return 'other';
}

export class CmcError extends Error {
  constructor(
    readonly endpoint: string,
    readonly code: number,
    readonly httpStatus: number,
    readonly cmcMessage: string,
  ) {
    super(`CMC ${endpoint} → HTTP ${httpStatus}, error_code ${code}: ${cmcMessage}`);
  }
  get kind(): CmcErrorClass {
    return classifyCmcError(this.code, this.httpStatus);
  }
}
