import type { Node, RefExpr, Span } from "@simvehicleapp/expr";
import {
  arithmetic,
  assignable,
  callType,
  compare,
  indexType,
  isArrayType,
  isIntegerType,
  literalType,
  logical,
  negate,
  type TypeErrorReason,
  type TypeInfo,
  type TypeResult,
  typeOf,
  unify,
  type ValueType,
} from "@simvehicleapp/types";
import { canonicalUnit, conversion } from "@simvehicleapp/units";

/**
 * S4 types + S5 units (ADR-0015 + Notes 2026-10-06 §7–§8, ADR-0018): types an SVX AST and lowers it
 * to an IR expression tree (contracts `ir.v1#/$defs/expr`). Every operator node carries its result
 * `type` (and `unit` when it has one) so backends never re-infer types; unit conversions are inserted
 * as `unit.convert` with the exact (scale, offset) rounded once.
 */

export type IrExpr = Record<string, unknown>;

export interface Typed {
  expr: IrExpr;
  info: TypeInfo;
  unit: string | null;
}

/** What a reference denotes (resolved by the compiler: block output, signal, variable, container). */
export interface RefBinding {
  /** IR reference: `{ $ref: "n3.value" }`, `{ $signal: "s0" }`, `{ $state: "v0" }`. */
  expr: IrExpr;
  type: ValueType;
  unit: string | null;
}

export interface TypeEnv {
  /** `undefined` = unresolved (already reported as EXPR_UNKNOWN_REF by S2): typing stays silent. */
  ref(ref: RefExpr): RefBinding | undefined;
}

export type TyperCode =
  | "TYPE_MISMATCH"
  | "TYPE_NARROWING_REQUIRES_CAST"
  | "VALUE_OUT_OF_RANGE"
  | "UNIT_DIMENSION_MISMATCH"
  | "UNIT_ASSUMED"
  | "UNIT_CONVERSION_INSERTED"
  | "ARRAY_VALUE_REQUIRES_INDEXING"
  | "ARRAY_INDEX_TYPE_INVALID"
  | "ARRAY_ELEMENT_TYPE_MISMATCH";

export interface TyperDiagnostic {
  code: TyperCode;
  message: string;
  span: Span;
  data: Record<string, unknown>;
}

/** Thrown inside the typer to stop a subtree after its error was recorded (or after an unresolved ref). */
class Poisoned extends Error {}

function constExpr(value: unknown, type: ValueType, unit: string | null): IrExpr {
  return unit ? { $const: value, type, unit } : { $const: value, type };
}

/** IR literal value: int64/uint64 as decimal strings (ADR-0018 §7), other integers/floats as numbers. */
function constValue(raw: string, type: ValueType): unknown {
  if (type === "int64" || type === "uint64") return BigInt(raw).toString();
  return Number(raw);
}

function op(name: string, operands: Record<string, IrExpr | IrExpr[]>, info: TypeInfo, unit: string | null): IrExpr {
  return { $expr: { op: name, ...operands, type: info.type, ...(unit ? { unit } : {}) } };
}

export class Typer {
  readonly diagnostics: TyperDiagnostic[] = [];
  constructor(private readonly env: TypeEnv) {}

  /** Types an expression; `undefined` when it has an error (recorded) or an unresolved reference. */
  type(ast: Node): Typed | undefined {
    try {
      return this.node(ast);
    } catch (e) {
      if (e instanceof Poisoned) return undefined;
      throw e;
    }
  }

  /**
   * A value stored into a typed target (actuator, variable, typed prop): unit conversion to the target
   * unit, then the assignment rule (ADR-0015 §3). Literal constants take the target type.
   */
  assign(value: Typed, target: { type: ValueType; unit: string | null }, span: Span): Typed | undefined {
    try {
      let v = value;
      if (target.unit && v.unit) v = this.convertTo(v, target.unit, span);
      const r = assignable(v.info, target.type);
      if (!r.ok) {
        if (r.reason === "out_of_range") {
          this.report("VALUE_OUT_OF_RANGE", span, `${this.literalText(v)} does not fit ${target.type}`, { type: target.type });
        } else if (r.reason === "narrowing") {
          this.report("TYPE_NARROWING_REQUIRES_CAST", span, `A ${v.info.type}${rangeText(v.info)} value may not fit ${target.type} — add a Convert block`, {
            from: v.info.type,
            to: target.type,
          });
        } else {
          this.report("TYPE_MISMATCH", span, `A ${v.info.type} value cannot be stored as ${target.type}`, { reason: r.reason, from: v.info.type, to: target.type });
        }
        return undefined;
      }
      const unit = target.unit ?? v.unit;
      const numericLiteral = v.info.literal && "$const" in v.expr && (v.info.type === "int64" || v.info.type === "uint64" || v.info.type === "double");
      if (numericLiteral && target.type !== v.info.type) {
        const raw = String(v.expr.$const);
        return { expr: constExpr(constValue(raw, target.type), target.type, unit), info: { ...typeOf(target.type), literal: true }, unit };
      }
      return { ...v, unit };
    } catch (e) {
      if (e instanceof Poisoned) return undefined;
      throw e;
    }
  }

  private report(code: TyperCode, span: Span, message: string, data: Record<string, unknown> = {}): void {
    this.diagnostics.push({ code, message, span, data });
  }

  private fail(r: { reason: TypeErrorReason }, span: Span, what: string): never {
    if (r.reason === "array_requires_indexing") {
      this.report("ARRAY_VALUE_REQUIRES_INDEXING", span, `${what}: an array must go through len(), at(), contains() or [index] first`, { reason: r.reason });
    } else {
      this.report("TYPE_MISMATCH", span, `${what}: ${REASON_TEXT[r.reason]}`, { reason: r.reason });
    }
    throw new Poisoned();
  }

  private literalText(v: Typed): string {
    return "$const" in v.expr ? String(v.expr.$const) : "The value";
  }

  private node(n: Node): Typed {
    switch (n.type) {
      case "number": {
        const info = literalType(n.raw);
        let unit: string | null = null;
        if (n.unit) {
          const u = canonicalUnit(n.unit);
          if (!u) {
            this.report("UNIT_DIMENSION_MISMATCH", n.span, `'${n.unit}' is not a VSS unit`, { reason: "unknown_unit", unit: n.unit });
            throw new Poisoned();
          }
          unit = u;
        }
        if (info.range && (info.range.min < -(2n ** 63n) || info.range.max > 2n ** 64n - 1n)) {
          this.report("TYPE_MISMATCH", n.span, `${n.raw} is too large for a 64-bit integer`, { reason: "integer_overflow" });
          throw new Poisoned();
        }
        const type: ValueType = info.type === "int64" && info.range!.min > 2n ** 63n - 1n ? "uint64" : info.type;
        return { expr: constExpr(constValue(n.raw, type), type, unit), info: { ...info, type }, unit };
      }
      case "string":
        return { expr: constExpr(n.value, "string", null), info: { type: "string", literal: true }, unit: null };
      case "bool":
        return { expr: constExpr(n.value, "boolean", null), info: { type: "boolean", literal: true }, unit: null };
      case "template": {
        const parts: (string | IrExpr)[] = [];
        for (const p of n.parts) parts.push(typeof p === "string" ? p : this.node(p).expr);
        return { expr: { $template: parts }, info: { type: "string" }, unit: null };
      }
      case "ref": {
        const b = this.env.ref(n);
        if (!b) throw new Poisoned();
        return { expr: b.expr, info: typeOf(b.type), unit: b.unit };
      }
      case "index": {
        const target = this.node(n.target);
        const index = this.node(n.index);
        const r = indexType(target.info, index.info);
        if (!r.ok) {
          if (r.reason === "not_numeric") {
            this.report("ARRAY_INDEX_TYPE_INVALID", n.index.span, `An array index must be a whole number, not ${index.info.type}`, { type: index.info.type });
            throw new Poisoned();
          }
          this.fail(r, n.span, "Indexing");
        }
        return { expr: op("array.index", { value: target.expr, index: index.expr }, r.info, target.unit), info: r.info, unit: target.unit };
      }
      case "unary": {
        const a = this.node(n.arg);
        if (n.op === "!") {
          const r = logical(a.info);
          if (!r.ok) this.fail(r, n.span, "'!'");
          return { expr: op("!", { a: a.expr }, r.info, null), info: r.info, unit: null };
        }
        const r = negate(a.info);
        if (!r.ok) this.fail(r, n.span, "'-'");
        // a negated literal stays a literal constant (`-3`, `-273.15 celsius`)
        if (a.info.literal && "$const" in a.expr && (a.info.type === "int64" || a.info.type === "uint64" || a.info.type === "double")) {
          const raw = String(a.expr.$const);
          const negRaw = raw.startsWith("-") ? raw.slice(1) : `-${raw}`;
          const type: ValueType = r.info.type;
          return { expr: constExpr(constValue(negRaw, type), type, a.unit), info: { ...r.info, literal: true }, unit: a.unit };
        }
        return { expr: op("neg", { a: a.expr }, r.info, a.unit), info: r.info, unit: a.unit };
      }
      case "binary":
        return this.binary(n.op, n.left, n.right, n.span);
      case "ternary": {
        const c = this.node(n.cond);
        if (c.info.type !== "boolean") this.fail({ reason: "not_boolean" }, n.cond.span, "Condition");
        const t = this.node(n.then);
        let e = this.node(n.else);
        e = this.unifyUnits(t, e, n.span, true);
        const r = unify(t.info, e.info);
        if (!r.ok) this.fail(r, n.span, "The two branches");
        const unit = t.unit ?? e.unit;
        return { expr: op("?:", { cond: c.expr, then: t.expr, else: e.expr }, r.info, unit), info: r.info, unit };
      }
      case "call":
        return this.call(n.name, n.args, n.span);
    }
  }

  private binary(o: string, ln: Node, rn: Node, span: Span): Typed {
    let l = this.node(ln);
    let r = this.node(rn);
    if (o === "&&" || o === "||") {
      const res = logical(l.info, r.info);
      if (!res.ok) this.fail(res, span, `'${o}'`);
      return { expr: op(o, { l: l.expr, r: r.expr }, res.info, null), info: res.info, unit: null };
    }
    if (o === "==" || o === "!=" || o === "<" || o === "<=" || o === ">" || o === ">=") {
      [l, r] = this.unifyPair(l, r, span);
      const res = compare(o, l.info, r.info);
      if (!res.ok) this.fail(res, span, `'${o}'`);
      return { expr: op(o, { l: l.expr, r: r.expr }, res.info, null), info: res.info, unit: null };
    }
    const arith = o as "+" | "-" | "*" | "/" | "%";
    let unit: string | null;
    if (arith === "+" || arith === "-" || arith === "%") {
      [l, r] = this.unifyPair(l, r, span);
      unit = l.unit ?? r.unit;
    } else {
      // × and ÷: a unit survives only against a plain number (unit algebra is out of scope in v1)
      unit = l.unit && r.unit ? null : (l.unit ?? (arith === "*" ? r.unit : null));
    }
    const res = arithmetic(arith, l.info, r.info);
    if (!res.ok) this.fail(res, span, `'${o}'`);
    return { expr: op(o, { l: l.expr, r: r.expr }, res.info, unit), info: res.info, unit };
  }

  /** Brings two operands to one unit: convert the right one to the left one's unit (ADR-0015 §5). */
  private unifyPair(l: Typed, r: Typed, span: Span): [Typed, Typed] {
    if (l.unit && r.unit) return [l, this.unifyUnits(l, r, span, false)];
    if (l.unit && !r.unit) return [l, this.assume(r, l.unit, span)];
    if (r.unit && !l.unit) return [this.assume(l, r.unit, span), r];
    return [l, r];
  }

  private unifyUnits(target: Typed, v: Typed, span: Span, assumeOk: boolean): Typed {
    if (!target.unit) return v;
    if (!v.unit) return assumeOk ? this.assume(v, target.unit, span) : v;
    return this.convertTo(v, target.unit, span);
  }

  /** A unit-less literal meeting a unit takes it (UNIT_ASSUMED, info). */
  private assume(v: Typed, unit: string, span: Span): Typed {
    if (v.info.literal && (v.info.type === "int64" || v.info.type === "uint64" || v.info.type === "double")) {
      this.report("UNIT_ASSUMED", span, `${this.literalText(v)} is read as ${unit}`, { unit });
      return { ...v, unit, expr: { ...v.expr, unit } };
    }
    return v;
  }

  private convertTo(v: Typed, to: string, span: Span): Typed {
    if (!v.unit || v.unit === to) return v;
    const c = conversion(v.unit, to);
    if ("reason" in c) {
      this.report("UNIT_DIMENSION_MISMATCH", span, `${v.unit} cannot be compared with or converted to ${to}`, c.reason === "unknown_unit" ? { reason: c.reason, unit: c.unit } : { from: c.from, to: c.to });
      throw new Poisoned();
    }
    if (c.identity) return { ...v, unit: to };
    this.report("UNIT_CONVERSION_INSERTED", span, `${v.unit} converted to ${to}`, { from: c.from, to: c.to, scale: c.scale, offset: c.offset });
    const info: TypeInfo = { type: "double" };
    if (isIntegerType(v.info.type) && v.info.range) {
      const r = arithmetic("*", v.info, { type: "double" });
      if (!r.ok) this.fail(r, span, `Converting ${v.unit} to ${to}`);
    }
    return {
      expr: op("unit.convert", { value: v.expr, from: c.from as never, to: c.to as never, scale: constExpr(c.scale, "double", null), offset: constExpr(c.offset, "double", null) }, info, to),
      info,
      unit: to,
    };
  }

  private call(name: string, argNodes: Node[], span: Span): Typed {
    let args = argNodes.map((a) => this.node(a));
    let unit: string | null = null;
    switch (name) {
      case "abs":
      case "round":
      case "floor":
      case "ceil":
        unit = args[0]!.unit;
        break;
      case "min":
      case "max":
      case "clamp":
        args = args.map((a, i) => (i === 0 ? a : this.unifyUnits(args[0]!, a, span, true)));
        unit = args[0]!.unit ?? args.find((a) => a.unit)?.unit ?? null;
        break;
      case "in_range":
        args = args.map((a, i) => (i === 0 ? a : this.unifyUnits(args[0]!, a, span, true)));
        break;
      case "scale":
        args = args.map((a, i) => (i === 1 || i === 2 ? this.unifyUnits(args[0]!, a, span, true) : i === 4 ? this.unifyUnits(args[3]!, a, span, true) : a));
        unit = args[3]!.unit ?? args[4]!.unit ?? null;
        break;
      case "contains": {
        const [arr, item] = args as [Typed, Typed];
        if (isArrayType(arr.info.type)) {
          const el = arr.info.type.slice(0, -2) as ValueType;
          if (!compare("==", typeOf(el), item.info).ok) {
            this.report("ARRAY_ELEMENT_TYPE_MISMATCH", argNodes[1]!.span, `contains(): the array holds ${el}, not ${item.info.type}`, { element: el, value: item.info.type });
            throw new Poisoned();
          }
        }
        break;
      }
      case "at": {
        const idx = args[1];
        if (idx && isArrayType(args[0]!.info.type) && !isIntegerType(idx.info.type)) {
          this.report("ARRAY_INDEX_TYPE_INVALID", argNodes[1]!.span, `An array index must be a whole number, not ${idx.info.type}`, { type: idx.info.type });
          throw new Poisoned();
        }
        unit = args[0]!.unit;
        break;
      }
      default:
        break;
    }
    const r: TypeResult = callType(name, args.map((a) => a.info));
    if (!r.ok) this.fail(r, span, `${name}()`);
    const exprArgs = args.map((a) => a.expr);
    const ir =
      name === "len"
        ? op("array.len", { value: exprArgs[0]! }, r.info, null)
        : name === "contains"
          ? op("array.contains", { value: exprArgs[0]!, item: exprArgs[1]! }, r.info, null)
          : name === "at"
            ? op("array.at", { value: exprArgs[0]!, index: exprArgs[1]!, ...(exprArgs[2] ? { default: exprArgs[2] } : {}) }, r.info, unit)
            : op(name, { args: exprArgs }, r.info, unit);
    return { expr: ir, info: r.info, unit };
  }
}

const rangeText = (t: TypeInfo) => (t.range && !t.literal ? ` (${t.range.min}…${t.range.max})` : "");

const REASON_TEXT: Record<TypeErrorReason, string> = {
  not_numeric: "needs numbers",
  not_boolean: "needs true/false values",
  not_comparable: "these values cannot be compared",
  string_arithmetic: "text cannot be added or computed — use a template \"…{<ref>}…\"",
  array_requires_indexing: "an array must be indexed first",
  integer_overflow: "the result may not fit a 64-bit integer",
  int64_precision: "a 64-bit integer would lose precision here — add a Convert block",
  time_arithmetic: "this combination of time values is not defined",
  not_array: "needs an array",
  branch_mismatch: "the two branches have different kinds of value",
};
