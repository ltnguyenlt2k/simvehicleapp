import { atom, call, display, type Node, prefix } from "./layout.ts";
import { constNode, pyString } from "./py.ts";

/**
 * IR `$expr` trees ⇒ Python expressions (IR_SPEC "Semantics every backend implements").
 *
 * Each operator calls the `simvehicleapp_runtime.values` helper (`V`) that ports the reference simulator's
 * case of the same operator, with the IR static types baked in: integers are exact Python `int`, `float`
 * results are rounded to binary32, `/` `%` follow JavaScript, templates format each part with its static
 * type. The compiler already checked types and units; `&&`, `||`, `?:` evaluate lazily like the simulator.
 */

export type IrExpr = Record<string, unknown>;

export interface ExprEnv {
  /** Python local of a signal / state id (declared in `bind`) and its type. */
  signalVar(id: string): { name: string; type: string };
  stateVar(id: string): { name: string; type: string };
  /** Static type of output `out` of trigger/node `node`. */
  outputType(node: string, out: string): string;
}

export interface PyExpr {
  code: Node;
  /** IR static type (formatting, conversions). */
  type: string;
}

/** What an emitted lambda needs: whether it reads the context `c`. */
export class ExprUse {
  ctx = false;
}

export class ExprEmitter {
  constructor(
    private readonly env: ExprEnv,
    private readonly use: ExprUse,
  ) {}

  emit(e: unknown): PyExpr {
    const o = e as IrExpr;
    if ("$const" in o) return { code: constNode(o.$const, String(o.type)), type: String(o.type) };
    if ("$ref" in o) {
      const [node, ...rest] = String(o.$ref).split(".");
      const out = rest.join(".");
      this.use.ctx = true;
      return { code: call("c.out", [atom(pyString(node!)), atom(pyString(out))]), type: this.env.outputType(node!, out) };
    }
    if ("$signal" in o) {
      const s = this.env.signalVar(String(o.$signal));
      this.use.ctx = true;
      return { code: call("c.signal", [atom(s.name)]), type: s.type };
    }
    if ("$state" in o) {
      const v = this.env.stateVar(String(o.$state));
      this.use.ctx = true;
      return { code: call("c.state", [atom(v.name)]), type: v.type };
    }
    if ("$template" in o) return this.template(o.$template as unknown[]);
    return this.op(o.$expr as IrExpr & { op: string; type: string });
  }

  /** Template part / conversion to string: the value formatted with its static type. */
  format(e: PyExpr): Node {
    return call("V.fmt", [e.code, atom(pyString(e.type))]);
  }

  /** The value converted to IR type `to` like the simulator's `cast(v, to, staticType)` (writes, state). */
  castTo(e: PyExpr, to: string): Node {
    return call("V.cast", [e.code, atom(pyString(to)), atom(pyString(e.type))]);
  }

  private template(parts: unknown[]): PyExpr {
    const pieces = parts.map((p) => (typeof p === "string" ? atom(pyString(p)) : this.format(this.emit(p))));
    if (pieces.length === 0) return { code: atom('""'), type: "string" };
    if (pieces.length === 1 && typeof parts[0] === "string") return { code: pieces[0]!, type: "string" };
    return { code: call("V.template", pieces), type: "string" };
  }

  private op(x: IrExpr & { op: string; type: string }): PyExpr {
    const t = x.type;
    const ev = (k: string) => this.emit(x[k]);
    const args = () => (x.args as unknown[]).map((a) => this.emit(a));
    const res = (code: Node): PyExpr => ({ code, type: t });
    const q = (text: string) => atom(pyString(text));
    const V = (fn: string, items: Node[]) => res(call(`V.${fn}`, items));
    const lazy = (n: Node) => prefix("lambda: ", n);
    switch (x.op) {
      case "+":
      case "-":
      case "*":
        return V("arith", [q(x.op), ev("l").code, ev("r").code, q(t)]);
      case "/":
        return V("div", [ev("l").code, ev("r").code]);
      case "%":
        return V("mod", [ev("l").code, ev("r").code]);
      case "neg":
        return V("neg", [ev("a").code]);
      case "==":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=":
        return V("compare", [q(x.op), ev("l").code, ev("r").code]);
      case "&&":
        return V("land", [ev("l").code, lazy(ev("r").code)]);
      case "||":
        return V("lor", [ev("l").code, lazy(ev("r").code)]);
      case "!":
        return V("lnot", [ev("a").code]);
      case "?:":
        return V("pick", [ev("cond").code, lazy(ev("then").code), lazy(ev("else").code)]);
      case "abs":
        return V("abs_", [args()[0]!.code]);
      case "min":
      case "max":
        return V("min_max", [q(x.op), display("[", args().map((a) => a.code)), q(t)]);
      case "clamp":
        return V("clamp", [...args().map((a) => a.code), q(t)]);
      case "round":
        return V("round_", args().map((a) => a.code));
      case "floor":
        return V("floor_", [args()[0]!.code]);
      case "ceil":
        return V("ceil_", [args()[0]!.code]);
      case "scale":
        return V("scale", args().map((a) => a.code));
      case "in_range":
        return V("in_range", args().map((a) => a.code));
      case "now_ms":
        this.use.ctx = true;
        return res(call("c.now_ms", []));
      case "array.len":
        return V("array_len", [ev("value").code]);
      case "array.contains":
        return V("array_contains", [ev("value").code, ev("item").code]);
      case "array.at":
      case "array.index": {
        const arr = ev("value").code;
        const idx = ev("index").code;
        if (x.op === "array.at" && x.default !== undefined) return V("array_at", [arr, idx, lazy(this.emit(x.default).code)]);
        return V("array_at", [arr, idx]);
      }
      case "unit.convert":
        return V("unit_convert", [ev("value").code, this.emit(x.scale).code, this.emit(x.offset).code]);
      case "type.cast": {
        const v = ev("value");
        return V("cast", [v.code, q(String(x.to)), q(v.type)]);
      }
      case "json.string": {
        const v = ev("value");
        return V("json_string", [v.code, q(v.type)]);
      }
      default:
        throw new UnsupportedOp(x.op);
    }
  }
}

export class UnsupportedOp extends Error {
  constructor(readonly op: string) {
    super(`expression operator ${op} is not supported by compiler-code-python`);
  }
}
