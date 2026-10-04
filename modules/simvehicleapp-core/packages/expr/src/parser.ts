import type { BinaryOp, Node, RefKind, Span } from "./ast.ts";
import { SVX_FUNCTIONS } from "./functions.ts";

/** ADR-0013 §6. */
export const MAX_SOURCE_LENGTH = 2000;
export const MAX_DEPTH = 64;

/** Diagnostic codes from contracts `diagnostics-catalog.v1.json` (public API — never renamed). */
export type SvxErrorCode = "EXPR_SYNTAX" | "EXPR_UNKNOWN_FUNCTION";

export type SvxSyntaxReason =
  | "empty"
  | "too_long"
  | "too_deep"
  | "unexpected_char"
  | "unexpected_token"
  | "unexpected_end"
  | "unterminated_string"
  | "bad_escape"
  | "bad_number"
  | "bad_ref"
  | "chained_comparison"
  | "unknown_identifier"
  | "wrong_arity"
  | "unbalanced_brace";

export interface SvxError {
  code: SvxErrorCode;
  reason: SvxSyntaxReason | "unknown_function";
  message: string;
  span: Span;
}

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: SvxError };

class ParseFailure extends Error {
  constructor(readonly error: SvxError) {
    super(error.message);
  }
}

type TokKind = "num" | "str" | "ref" | "ident" | "op" | "eof";
interface Tok {
  kind: TokKind;
  text: string;
  /** num: unit; str: decoded parts (text | embedded source span) */
  unit?: string;
  parts?: (string | Span)[];
  span: Span;
}

const REF = /^<([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)>/;
const NUMBER = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const UNIT = /^[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)?/;
const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", ",", "(", ")", "[", "]"];
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", n: "\n", t: "\t", "{": "{", "}": "}" };

const fail = (reason: SvxSyntaxReason, message: string, span: Span, code: SvxErrorCode = "EXPR_SYNTAX"): never => {
  throw new ParseFailure({ code, reason, message, span });
};

/** Could `src[i…]` start an operand? Decides whether a `%` after a number is a unit or modulo. */
function startsOperand(src: string, i: number): boolean {
  while (i < src.length && /\s/.test(src[i]!)) i++;
  const c = src[i];
  if (c === undefined) return false;
  if (/[0-9A-Za-z_"(!-]/.test(c)) return true;
  return c === "<" && REF.test(src.slice(i));
}

function lex(src: string, base = 0): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  // Clamped: error spans must always lie inside the source (found by fuzzing).
  const span = (start: number, end: number): Span => ({
    start: base + Math.min(start, src.length),
    end: base + Math.min(end, src.length),
  });
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (/[0-9]/.test(c)) {
      const m = NUMBER.exec(rest)!;
      let end = i + m[0].length;
      if (src[end] === ".") fail("bad_number", `Malformed number '${src.slice(i, end + 1)}'`, span(i, end + 1));
      const tok: Tok = { kind: "num", text: m[0], span: span(i, end) };
      let j = end;
      while (j < src.length && src[j] === " ") j++;
      const u = UNIT.exec(src.slice(j));
      if (u && src[j + u[0].length] !== "(" && u[0] !== "true" && u[0] !== "false") {
        tok.unit = u[0];
        end = j + u[0].length;
      } else if (src[j] === "%" && !startsOperand(src, j + 1)) {
        tok.unit = "%";
        end = j + 1;
      }
      tok.span = span(i, end);
      toks.push(tok);
      i = end;
      continue;
    }
    if (c === '"') {
      const parts: (string | Span)[] = [];
      let text = "";
      let j = i + 1;
      for (;;) {
        const ch = src[j];
        if (ch === undefined) fail("unterminated_string", "String is not closed with \"", span(i, j));
        if (ch === '"') break;
        if (ch === "\\") {
          const e = ESCAPES[src[j + 1] ?? ""];
          if (e === undefined) fail("bad_escape", `Unknown escape '\\${src[j + 1] ?? ""}'`, span(j, Math.min(j + 2, src.length)));
          text += e;
          j += 2;
          continue;
        }
        if (ch === "{") {
          // Template part: find the matching `}` outside nested strings.
          let depth = 1;
          let k = j + 1;
          let inStr = false;
          while (k < src.length && depth > 0) {
            const d = src[k]!;
            if (inStr) {
              if (d === "\\") k++;
              else if (d === '"') inStr = false;
            } else if (d === '"') inStr = true;
            else if (d === "{") depth++;
            else if (d === "}") depth--;
            k++;
          }
          if (depth > 0) fail("unbalanced_brace", "Template '{' is not closed with '}'", span(j, k));
          if (text) parts.push(text);
          text = "";
          parts.push(span(j + 1, k - 1));
          j = k;
          continue;
        }
        if (ch === "}") fail("unbalanced_brace", "Unescaped '}' in string (write \\})", span(j, j + 1));
        text += ch;
        j++;
      }
      if (text || parts.length === 0) parts.push(text);
      toks.push({ kind: "str", text: src.slice(i, j + 1), parts, span: span(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === "<") {
      const m = REF.exec(rest);
      if (m) {
        toks.push({ kind: "ref", text: m[1]!, span: span(i, i + m[0].length) });
        i += m[0].length;
        continue;
      }
      // Looks like an attempted reference (`<a b.c>`, `<a..b>`, `<a.b`): explain instead of
      // falling through to the comparison operator. Only when a letter/_ follows `<` directly, so
      // `<x.y> < 2.5 && …` stays a comparison.
      const closed = /^<[A-Za-z_][^<>"()]*>/.exec(rest);
      if (closed && /[.\s-]/.test(closed[0])) {
        fail("bad_ref", "Malformed reference: use <name.field> with letters, digits and _ only, separated by single dots", span(i, i + closed[0].length));
      }
      const open = /^<[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]*(?![A-Za-z0-9_.>])/.exec(rest);
      if (open) fail("bad_ref", "Reference is not closed with '>'", span(i, i + open[0].length));
    }
    if (c === "." && toks.at(-1)?.kind === "ident") {
      const prev = toks.at(-1)!;
      const path = /^[A-Za-z0-9_.]*/.exec(src.slice(prev.span.start - base))![0];
      fail("unknown_identifier", `Write references in angle brackets, e.g. <${path}>`, { start: prev.span.start, end: base + i + 1 });
    }
    const id = IDENT.exec(rest);
    if (id) {
      toks.push({ kind: "ident", text: id[0], span: span(i, i + id[0].length) });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      toks.push({ kind: "op", text: op, span: span(i, i + op.length) });
      i += op.length;
      continue;
    }
    if (c === "<") fail("bad_ref", "Malformed reference: expected <name.field>", span(i, i + 1));
    fail("unexpected_char", `Unexpected character '${c}'`, span(i, i + 1));
  }
  toks.push({ kind: "eof", text: "", span: span(src.length, src.length) });
  return toks;
}

const BINARY_POWER: Readonly<Record<string, number>> = {
  "||": 2,
  "&&": 3,
  "==": 5,
  "!=": 5,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};
const COMPARISON = 5;

function refKind(path: string[]): RefKind {
  switch (path[0]) {
    case "Vehicle":
      return "vehicle";
    case "variable":
      return "variable";
    case "loop":
      return "loop";
    case "parallel":
      return "parallel";
    default:
      return "block";
  }
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly src: string,
    private readonly toks: Tok[],
    private readonly base: number,
  ) {}

  private peek(): Tok {
    return this.toks[this.pos]!;
  }

  private next(): Tok {
    return this.toks[this.pos++]!;
  }

  private isOp(text: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.text === text;
  }

  private expectOp(text: string, what: string): Tok {
    const t = this.peek();
    if (t.kind === "op" && t.text === text) return this.next();
    return this.unexpected(t, `Expected '${text}' ${what}`);
  }

  private unexpected(t: Tok, message?: string): never {
    if (t.kind === "eof") return fail("unexpected_end", message ?? "Expression ends too early", t.span);
    return fail("unexpected_token", message ?? `Unexpected '${t.text}'`, t.span);
  }

  private enter(span: Span): void {
    if (++this.depth > MAX_DEPTH) fail("too_deep", `Expression is nested deeper than ${MAX_DEPTH} levels`, span);
  }

  parseAll(): Node {
    const node = this.expr(0);
    const t = this.peek();
    if (t.kind !== "eof") this.unexpected(t);
    return node;
  }

  /** Pratt loop: `minPower` is the weakest operator this call may consume. */
  private expr(minPower: number): Node {
    this.enter(this.peek().span);
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "op") break;
      if (t.text === "?" && minPower <= 1) {
        this.next();
        const then = this.expr(0);
        this.expectOp(":", "between the branches of '? :'");
        const otherwise = this.expr(1);
        left = { type: "ternary", cond: left, then, else: otherwise, span: { start: left.span.start, end: otherwise.span.end } };
        continue;
      }
      const power = BINARY_POWER[t.text];
      if (power === undefined || power < minPower) break;
      this.next();
      const right = this.expr(power + 1);
      if (power === COMPARISON) {
        const after = this.peek();
        if (after.kind === "op" && BINARY_POWER[after.text] === COMPARISON) {
          fail("chained_comparison", "Comparisons cannot be chained; combine them with && or ||", after.span);
        }
      }
      left = { type: "binary", op: t.text as BinaryOp, left, right, span: { start: left.span.start, end: right.span.end } };
    }
    this.depth--;
    return left;
  }

  private prefix(): Node {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return this.postfix({ type: "number", raw: t.text, ...(t.unit ? { unit: t.unit } : {}), span: t.span });
      case "str":
        return this.postfix(this.stringNode(t));
      case "ref": {
        const path = t.text.split(".");
        const kind = refKind(path);
        if (path.length < 2) {
          const hint = kind === "vehicle" ? "<Vehicle.Speed>" : `<${t.text}.value>`;
          fail("bad_ref", `Reference <${t.text}> is incomplete, e.g. ${hint}`, t.span);
        }
        return this.postfix({ type: "ref", kind, path, span: t.span });
      }
      case "ident": {
        if (t.text === "true" || t.text === "false") return { type: "bool", value: t.text === "true", span: t.span };
        if (!this.isOp("(")) {
          return fail(
            "unknown_identifier",
            `Unknown name '${t.text}': use a reference such as <Vehicle.Speed> or <blockname.value>`,
            t.span,
          );
        }
        // Own properties only: `constructor`, `__proto__`, `toString`… must never resolve.
        const arity = Object.hasOwn(SVX_FUNCTIONS, t.text) ? SVX_FUNCTIONS[t.text] : undefined;
        if (!arity) {
          throw new ParseFailure({
            code: "EXPR_UNKNOWN_FUNCTION",
            reason: "unknown_function",
            message: `Unknown function '${t.text}'`,
            span: t.span,
          });
        }
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.expr(0));
            if (!this.isOp(",")) break;
            this.next();
          }
        }
        const close = this.expectOp(")", `to close ${t.text}(…)`);
        const span = { start: t.span.start, end: close.span.end };
        if (args.length < arity.min || args.length > arity.max) {
          const want = arity.min === arity.max ? `${arity.min}` : `${arity.min}–${arity.max}`;
          fail("wrong_arity", `${t.text}() takes ${want} argument(s), got ${args.length}`, span);
        }
        return this.postfix({ type: "call", name: t.text, args, span });
      }
      case "op": {
        if (t.text === "(") {
          const inner = this.expr(0);
          this.expectOp(")", "to close '('");
          return this.postfix(inner);
        }
        if (t.text === "-") {
          const arg = this.expr(8);
          return { type: "unary", op: "-", arg, span: { start: t.span.start, end: arg.span.end } };
        }
        if (t.text === "!") {
          // `!a == b` is `!(a == b)` (grammar: not := '!' not | cmp).
          const arg = this.expr(4);
          return { type: "unary", op: "!", arg, span: { start: t.span.start, end: arg.span.end } };
        }
        return this.unexpected(t);
      }
      default:
        return this.unexpected(t);
    }
  }

  private postfix(node: Node): Node {
    while (this.isOp("[")) {
      this.next();
      const index = this.expr(0);
      const close = this.expectOp("]", "to close '['");
      node = { type: "index", target: node, index, span: { start: node.span.start, end: close.span.end } };
    }
    return node;
  }

  private stringNode(t: Tok): Node {
    const parts = t.parts!;
    if (parts.every((p) => typeof p === "string")) {
      return { type: "string", value: (parts as string[]).join(""), span: t.span };
    }
    return {
      type: "template",
      parts: parts.map((p) => {
        if (typeof p === "string") return p;
        const inner = this.src.slice(p.start - this.base, p.end - this.base);
        if (inner.trim() === "") fail("unexpected_end", "Empty '{}' in template", { start: p.start - 1, end: p.end + 1 });
        return parseAt(this.src, p.start - this.base, p.end - this.base, this.base, this.depth);
      }),
      span: t.span,
    };
  }
}

function parseAt(src: string, from: number, to: number, base: number, depth: number): Node {
  const slice = src.slice(from, to);
  const parser = new Parser(slice, lex(slice, base + from), base + from);
  (parser as unknown as { depth: number }).depth = depth;
  return parser.parseAll();
}

/**
 * Parses an SVX expression (analysis/06 §4) into an AST with source spans. Pure and deterministic;
 * never evaluates anything. Errors carry a catalog code, a machine-readable reason and the span.
 */
export function parseExpression(source: string): ParseResult {
  try {
    if (source.length > MAX_SOURCE_LENGTH) {
      fail("too_long", `Expression is longer than ${MAX_SOURCE_LENGTH} characters`, { start: MAX_SOURCE_LENGTH, end: source.length });
    }
    if (source.trim() === "") fail("empty", "Expression is empty", { start: 0, end: source.length });
    return { ok: true, ast: parseAt(source, 0, source.length, 0, 0) };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: e.error };
    if (e instanceof RangeError) {
      // Defensive: a pathological input must still produce a diagnostic, never crash the caller.
      return { ok: false, error: { code: "EXPR_SYNTAX", reason: "too_deep", message: "Expression is too complex", span: { start: 0, end: source.length } } };
    }
    throw e;
  }
}
