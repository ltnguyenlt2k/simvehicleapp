import type { Grammar } from 'prismjs'

/** Functions SVX accepts (ADR-0013 §2, ADR-0018 §3); mirrors core `packages/expr` `SVX_FUNCTIONS`. */
export const SVX_FUNCTION_NAMES = [
  'abs',
  'min',
  'max',
  'clamp',
  'round',
  'floor',
  'ceil',
  'scale',
  'in_range',
  'now_ms',
  'len',
  'at',
  'contains',
] as const

/**
 * Prism grammar for SVX highlighting (ADR-0013 §4, editor stack decided 2026-10-04). Order matters:
 * references before operators so `<Vehicle.Speed>` is one token, numbers carry their unit.
 */
export const SVX_GRAMMAR: Grammar = {
  string: { pattern: /"(?:\\.|[^"\\])*"/, greedy: true },
  variable: /<[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+>/,
  number:
    /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:\s*(?:%|[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)?))?/,
  function: new RegExp(`\\b(?:${SVX_FUNCTION_NAMES.join('|')})(?=\\s*\\()`),
  boolean: /\b(?:true|false)\b/,
  operator: /==|!=|<=|>=|&&|\|\||[+\-*/%!<>?:]/,
  punctuation: /[()[\],{}]/,
}
