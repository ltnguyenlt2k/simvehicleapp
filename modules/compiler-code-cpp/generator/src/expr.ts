import { cppString, cppType, doubleLiteral, intLiteral, isArray, isIntLike } from "./cpp.ts";

/**
 * IR `$expr` trees ⇒ typed C++ expressions (IR_SPEC "Semantics every backend implements").
 *
 * Values evaluate in the C++ type that mirrors the reference simulator: integers are exact
 * `int64_t` (`uint64_t` for uint64), `float` results are rounded to binary32, operations the
 * simulator computes as plain numbers (`/`, `%`, `round`, `scale`, `unit.convert`…) are `double`.
 * Templates format each part with its IR static type. The compiler already checked types and units.
 */

export type IrExpr = Record<string, unknown>;

export interface ExprEnv {
  /** C++ variable of a signal / topic / state id (declared in `bind`). */
  signalVar(id: string): { name: string; type: string };
  stateVar(id: string): { name: string; type: string };
  /** Static type of output `out` of trigger/node `node`. */
  outputType(node: string, out: string): string;
}

export interface CppExpr {
  code: string;
  /** C++ type the expression evaluates to. */
  kind: string;
  /** IR static type (formatting). */
  type: string;
}

/** What an emitted lambda needs: the context parameter and the locals it captures. */
export class ExprUse {
  ctx = false;
  readonly captures = new Set<string>();
}

/** C++ evaluation type of an IR static type. */
export function kindOf(type: string): string {
  if (isArray(type)) return `std::vector<${kindOf(type.slice(0, -2))}>`;
  if (isIntLike(type)) return type === "uint64" ? "uint64_t" : "int64_t";
  return cppType(type);
}

const isIntKind = (k: string) => k === "int64_t" || k === "uint64_t";
const dbl = (e: CppExpr) => (e.kind === "double" ? e.code : `static_cast<double>(${e.code})`);
const i64 = (e: CppExpr) => (e.kind === "int64_t" ? e.code : `static_cast<int64_t>(${e.code})`);

export class ExprEmitter {
  constructor(
    private readonly env: ExprEnv,
    private readonly use: ExprUse,
  ) {}

  emit(e: unknown): CppExpr {
    const o = e as IrExpr;
    if ("$const" in o) return this.constant(o.$const, String(o.type));
    if ("$ref" in o) {
      const [node, ...rest] = String(o.$ref).split(".");
      const out = rest.join(".");
      const type = this.env.outputType(node!, out);
      this.use.ctx = true;
      return { code: `c.out<${kindOf(type)}>(${cppString(node!)}, ${cppString(out)})`, kind: kindOf(type), type };
    }
    if ("$signal" in o) {
      const s = this.env.signalVar(String(o.$signal));
      this.use.ctx = true;
      this.use.captures.add(s.name);
      return { code: `c.signal<${kindOf(s.type)}>(${s.name})`, kind: kindOf(s.type), type: s.type };
    }
    if ("$state" in o) {
      const v = this.env.stateVar(String(o.$state));
      this.use.ctx = true;
      this.use.captures.add(v.name);
      return { code: `c.state<${kindOf(v.type)}>(${v.name})`, kind: kindOf(v.type), type: v.type };
    }
    if ("$template" in o) return this.template(o.$template as unknown[]);
    return this.op(o.$expr as IrExpr & { op: string; type: string });
  }

  /** A literal (`$const`) of IR type `type`. */
  constant(v: unknown, type: string): CppExpr {
    const kind = kindOf(type);
    if (v === null || v === undefined) throw new Error("compiler-code-cpp: null constant");
    if (isArray(type)) {
      const el = type.slice(0, -2);
      const items = (v as unknown[]).map((x) => this.constant(x, el).code);
      return { code: `${kind}{${items.join(", ")}}`, kind, type };
    }
    if (isIntLike(type)) return { code: intLiteral(v as string | number, type), kind, type };
    if (type === "float") return { code: `static_cast<float>(${doubleLiteral(Number(v))})`, kind, type };
    if (type === "double") return { code: doubleLiteral(Number(v)), kind, type };
    if (type === "boolean") return { code: v ? "true" : "false", kind, type };
    if (type === "string") return { code: `std::string(${cppString(String(v))})`, kind, type };
    throw new Error(`compiler-code-cpp: no literal of type ${type}`);
  }

  /** Template part / `type.cast` to string: the value formatted with its static type. */
  format(e: CppExpr): string {
    if (e.kind === "std::string") return e.code;
    if (e.type === "float") return e.kind === "float" ? `rt::format(${e.code})` : `rt::formatAsFloat(${dbl(e)})`;
    if (e.type === "json" || isArray(e.type)) return `rt::formatValue(rt::toValue(${e.code}), ${cppString(e.type)})`;
    if (e.type === "double") return `rt::format(${dbl(e)})`;
    return `rt::format(${e.code})`;
  }

  /** The value converted to IR type `to` like the simulator's `cast(v, to, staticType)`. */
  castTo(e: CppExpr, to: string): string {
    if (to === "string") return this.format(e);
    const target = cppType(to);
    if (e.kind === target) return e.code;
    if (to === "float") return `static_cast<float>(${dbl(e)})`;
    if (to === "double") return dbl(e);
    return `rt::as<${target}>(${e.code})`;
  }

  private template(parts: unknown[]): CppExpr {
    // Only the first piece must be a std::string for `+` to concatenate; later literals stay plain.
    const pieces = parts.map((p, i) => (typeof p === "string" ? (i === 0 ? `std::string(${cppString(p)})` : cppString(p)) : this.format(this.emit(p))));
    if (pieces.length === 0) return { code: "std::string()", kind: "std::string", type: "string" };
    if (pieces.length === 1) return { code: pieces[0]!, kind: "std::string", type: "string" };
    return { code: `(${pieces.join(" + ")})`, kind: "std::string", type: "string" };
  }

  private op(x: IrExpr & { op: string; type: string }): CppExpr {
    const t = x.type;
    const kind = kindOf(t);
    const ev = (k: string) => this.emit(x[k]);
    const args = () => (x.args as unknown[]).map((a) => this.emit(a));
    const res = (code: string, k = kind): CppExpr => ({ code, kind: k, type: t });
    switch (x.op) {
      case "+":
      case "-":
      case "*": {
        const l = ev("l");
        const r = ev("r");
        if (isIntLike(t)) return res(`(${i64(l)} ${x.op} ${i64(r)})`, "int64_t");
        if (t === "float") return res(`static_cast<float>(${dbl(l)} ${x.op} ${dbl(r)})`, "float");
        return res(`(${dbl(l)} ${x.op} ${dbl(r)})`, "double");
      }
      case "/":
        return res(`(${dbl(ev("l"))} / ${dbl(ev("r"))})`, "double");
      case "%":
        return res(`std::fmod(${dbl(ev("l"))}, ${dbl(ev("r"))})`, "double");
      case "neg": {
        const a = ev("a");
        if (isIntKind(a.kind)) return res(`(-${i64(a)})`, "int64_t");
        return res(`(-${a.code})`, a.kind);
      }
      case "==":
        return res(`rt::eq(${ev("l").code}, ${ev("r").code})`, "bool");
      case "!=":
        return res(`!rt::eq(${ev("l").code}, ${ev("r").code})`, "bool");
      case "<":
        return res(`rt::lt(${ev("l").code}, ${ev("r").code})`, "bool");
      case "<=":
        return res(`rt::le(${ev("l").code}, ${ev("r").code})`, "bool");
      case ">":
        return res(`rt::gt(${ev("l").code}, ${ev("r").code})`, "bool");
      case ">=":
        return res(`rt::ge(${ev("l").code}, ${ev("r").code})`, "bool");
      case "&&":
        return res(`(${ev("l").code} && ${ev("r").code})`, "bool");
      case "||":
        return res(`(${ev("l").code} || ${ev("r").code})`, "bool");
      case "!":
        return res(`(!${ev("a").code})`, "bool");
      case "?:": {
        const c = ev("cond");
        const a = ev("then");
        const b = ev("else");
        const k = a.kind === b.kind ? a.kind : kind;
        const conv = (e: CppExpr) => (e.kind === k ? e.code : k === "double" ? dbl(e) : `rt::as<${k}>(${e.code})`);
        return res(`(${c.code} ? ${conv(a)} : ${conv(b)})`, k);
      }
      case "abs": {
        const [a] = args();
        if (isIntKind(a!.kind)) return res(`rt::absInt(${i64(a!)})`, "int64_t");
        return res(`std::fabs(${dbl(a!)})`, "double");
      }
      case "min":
      case "max": {
        const vs = args();
        if (isIntLike(t)) return res(`std::${x.op}<int64_t>({${vs.map(i64).join(", ")}})`, "int64_t");
        const call = `rt::js${x.op === "min" ? "Min" : "Max"}({${vs.map(dbl).join(", ")}})`;
        return t === "float" ? res(`static_cast<float>(${call})`, "float") : res(call, "double");
      }
      case "clamp": {
        const [v, lo, hi] = args();
        if (isIntLike(t)) return res(`rt::clampInt(${i64(v!)}, ${i64(lo!)}, ${i64(hi!)})`, "int64_t");
        const call = `rt::jsMin({rt::jsMax({${dbl(v!)}, ${dbl(lo!)}}), ${dbl(hi!)}})`;
        return t === "float" ? res(`static_cast<float>(${call})`, "float") : res(call, "double");
      }
      case "round": {
        const [v, d] = args();
        return res(d ? `rt::roundTo(${dbl(v!)}, ${dbl(d)})` : `rt::roundHalfAway(${dbl(v!)})`, "double");
      }
      case "floor":
        return res(`std::floor(${dbl(args()[0]!)})`, "double");
      case "ceil":
        return res(`std::ceil(${dbl(args()[0]!)})`, "double");
      case "scale": {
        const vs = args().map(dbl);
        return res(`rt::scale(${vs.join(", ")})`, "double");
      }
      case "in_range": {
        const [v, lo, hi] = args();
        return res(`(rt::ge(${v!.code}, ${lo!.code}) && rt::le(${v!.code}, ${hi!.code}))`, "bool");
      }
      case "now_ms":
        this.use.ctx = true;
        return res("c.nowMs()", "int64_t");
      case "array.len":
        return res(`static_cast<int64_t>(${ev("value").code}.size())`, "int64_t");
      case "array.contains":
        return res(`rt::arrayContains(${ev("value").code}, ${ev("item").code})`, "bool");
      case "array.at":
      case "array.index": {
        const arr = ev("value");
        const idx = ev("index");
        const el = kindOf(arr.type.slice(0, -2));
        if (x.op === "array.at" && x.default !== undefined) {
          const def = this.emit(x.default);
          const d = def.kind === el ? def.code : el === "double" ? dbl(def) : `rt::as<${el}>(${def.code})`;
          return res(`rt::arrayAt(${arr.code}, ${idx.code}, ${d})`, el);
        }
        return res(`rt::arrayIndex(${arr.code}, ${idx.code})`, el);
      }
      case "unit.convert": {
        const v = ev("value");
        const scale = this.emit(x.scale);
        const offset = this.emit(x.offset);
        return res(`(${dbl(v)} * ${dbl(scale)} + ${dbl(offset)})`, "double");
      }
      case "type.cast": {
        const v = ev("value");
        const to = String(x.to);
        if (to === "string") return res(this.format(v), "std::string");
        if (to === "uint64") return res(`rt::as<uint64_t>(${v.code})`, "uint64_t");
        if (isIntLike(to)) return res(`static_cast<int64_t>(rt::as<${cppType(to)}>(${v.code}))`, "int64_t");
        return res(this.castTo(v, to), cppType(to));
      }
      case "json.string":
        return res(`rt::jsonString(${this.format(ev("value"))})`, "std::string");
      default:
        throw new UnsupportedOp(x.op);
    }
  }
}

export class UnsupportedOp extends Error {
  constructor(readonly op: string) {
    super(`expression operator ${op} is not supported by compiler-code-cpp`);
  }
}
