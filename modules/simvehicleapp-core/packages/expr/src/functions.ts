/**
 * Whitelisted SVX functions and their arity (ADR-0013 §2, ADR-0018 §3). Nothing else can be
 * called — there is no `eval` and no access to host functions.
 */
export const SVX_FUNCTIONS: Readonly<Record<string, { min: number; max: number }>> = {
  abs: { min: 1, max: 1 },
  min: { min: 2, max: 16 },
  max: { min: 2, max: 16 },
  clamp: { min: 3, max: 3 },
  round: { min: 1, max: 2 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  scale: { min: 5, max: 5 },
  in_range: { min: 3, max: 3 },
  now_ms: { min: 0, max: 0 },
  len: { min: 1, max: 1 },
  at: { min: 2, max: 3 },
  contains: { min: 2, max: 2 },
};
