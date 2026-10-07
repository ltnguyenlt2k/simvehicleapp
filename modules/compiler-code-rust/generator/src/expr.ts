import { atom, call, type Node, prefix } from "./layout.ts";
import { constNode, rsString } from "./rs.ts";

/**
 * IR `$expr` trees ⇒ Rust expressions of type `Value` (IR_SPEC "Semantics every backend implements").
 *
 * Each operator calls the `simvehicleapp_runtime::values` helper (`v`) that ports the reference simulator's
 * case of the same operator, static types baked in; helpers return `R = Result<Value, EvalError>` and the
 * emitted code applies `?`, so a missing value ends the expression with the node's `no_value` error.
 * `&&`, `||`, `?:` and `array.at` defaults are closures: evaluated lazily, like the simulator.
 */

export type IrExpr = Record<string, unknown>;

export interface ExprEnv {
  signal(id: string): { path: string; type: string };
  stateType(id: string): string;
  outputType(node: string, out: string): string;
}

export interface RsExpr {
  /** An expression of type `Value`. */
  code: Node;
  type: string;
}

export class ExprUse {
  ctx = false;
}

const q = (s: string) => atom(rsString(s));
const ref = (n: Node) => prefix("&", n);
/** `f(…)?` — the call's result propagated. */
const tried = (n: Node): Node => (n.kind === "group" ? { ...n, close: `${n.close}?` } : atom(`${n.text}?`));
/** `|| <fallible call>` as it is, else `|| Ok(<value>)` — evaluated only when needed. */
const lazy = (n: Node): Node => {
  if (n.kind === "group" && n.close.endsWith("?")) return prefix("|| ", { ...n, close: n.close.slice(0, -1) });
  if (n.kind === "atom" && n.text.endsWith("?")) return atom(`|| ${n.text.slice(0, -1)}`);
  return prefix("|| Ok(", { ...wrap(n), head: "" });
};
function wrap(n: Node): Node & { kind: "group" } {
  // `|| Ok(<n>)` as a group so long bodies still break at the parenthesis.
  return { kind: "group", head: "", open: "", items: [n], close: ")", display: false };
}

export class ExprEmitter {
  constructor(
    private readonly env: ExprEnv,
    private readonly use: ExprUse,
  ) {}

  emit(e: unknown): RsExpr {
    const o = e as IrExpr;
    if ("$const" in o) return { code: constNode(o.$const, String(o.type)), type: String(o.type) };
    if ("$ref" in o) {
      const [node, ...rest] = String(o.$ref).split(".");
      const out = rest.join(".");
      this.use.ctx = true;
      return { code: tried(call("c.out", [q(node!), q(out)])), type: this.env.outputType(node!, out) };
    }
    if ("$signal" in o) {
      const id = String(o.$signal);
      const s = this.env.signal(id);
      this.use.ctx = true;
      return { code: tried(call("c.signal", [q(id), q(s.path)])), type: s.type };
    }
    if ("$state" in o) {
      const id = String(o.$state);
      this.use.ctx = true;
      return { code: tried(call("c.state", [q(id)])), type: this.env.stateType(id) };
    }
    if ("$template" in o) return this.template(o.$template as unknown[]);
    return this.op(o.$expr as IrExpr & { op: string; type: string });
  }

  /** Template part: the value formatted with its static type (a `String`). */
  format(e: RsExpr): Node {
    return call("v::f", [ref(e.code), q(e.type)]);
  }

  /** The value converted to IR type `to` like the simulator's `cast(v, to, staticType)` (writes, state). */
  castTo(e: RsExpr, to: string): Node {
    return call("v::cast", [ref(e.code), q(to), q(e.type)]);
  }

  private template(parts: unknown[]): RsExpr {
    const pieces = parts.map((p) => (typeof p === "string" ? call("String::from", [q(p)]) : this.format(this.emit(p))));
    if (pieces.length === 0) return { code: atom('Value::str("")'), type: "string" };
    return { code: tried(call("v::template", [prefix("&", { kind: "group", head: "", open: "[", items: pieces, close: "]", display: true })])), type: "string" };
  }

  private op(x: IrExpr & { op: string; type: string }): RsExpr {
    const t = x.type;
    const ev = (k: string) => this.emit(x[k]);
    const args = () => (x.args as unknown[]).map((a) => this.emit(a));
    const V = (fn: string, items: Node[]): RsExpr => ({ code: tried(call(`v::${fn}`, items)), type: t });
    const values = (xs: RsExpr[]) => prefix("&", { kind: "group", head: "", open: "[", items: xs.map((a) => a.code), close: "]", display: true });
    switch (x.op) {
      case "+":
      case "-":
      case "*":
        return V("arith", [q(x.op), ref(ev("l").code), ref(ev("r").code), q(t)]);
      case "/":
        return V("div", [ref(ev("l").code), ref(ev("r").code)]);
      case "%":
        return V("modulo", [ref(ev("l").code), ref(ev("r").code)]);
      case "neg":
        return V("neg", [ref(ev("a").code)]);
      case "==":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=":
        return V("compare", [q(x.op), ref(ev("l").code), ref(ev("r").code)]);
      case "&&":
        return V("land", [ref(ev("l").code), lazy(ev("r").code)]);
      case "||":
        return V("lor", [ref(ev("l").code), lazy(ev("r").code)]);
      case "!":
        return V("lnot", [ref(ev("a").code)]);
      case "?:":
        return V("pick", [ref(ev("cond").code), lazy(ev("then").code), lazy(ev("else").code)]);
      case "abs":
        return V("abs", [ref(args()[0]!.code)]);
      case "min":
      case "max":
        return V("min_max", [q(x.op), values(args()), q(t)]);
      case "clamp":
        return V("clamp", [...args().map((a) => ref(a.code)), q(t)]);
      case "round": {
        const [v, d] = args();
        return V("round", [ref(v!.code), d ? prefix("Some(&", { ...wrap(d.code), head: "" }) : atom("None")]);
      }
      case "floor":
        return V("floor", [ref(args()[0]!.code)]);
      case "ceil":
        return V("ceil", [ref(args()[0]!.code)]);
      case "scale":
        return V("scale", args().map((a) => ref(a.code)));
      case "in_range":
        return V("in_range", args().map((a) => ref(a.code)));
      case "now_ms":
        this.use.ctx = true;
        return { code: atom("c.now_ms()?"), type: t };
      case "array.len":
        return V("array_len", [ref(ev("value").code)]);
      case "array.contains":
        return V("array_contains", [ref(ev("value").code), ref(ev("item").code)]);
      case "array.at":
      case "array.index": {
        const arr = ref(ev("value").code);
        const idx = ref(ev("index").code);
        if (x.op === "array.at" && x.default !== undefined) return V("array_at_or", [arr, idx, lazy(this.emit(x.default).code)]);
        return V("array_at", [arr, idx, atom("None")]);
      }
      case "unit.convert":
        return V("unit_convert", [ref(ev("value").code), ref(this.emit(x.scale).code), ref(this.emit(x.offset).code)]);
      case "type.cast": {
        const v = ev("value");
        return { code: call("v::cast", [ref(v.code), q(String(x.to)), q(v.type)]), type: t };
      }
      case "json.string": {
        const v = ev("value");
        return V("json_string", [ref(v.code), q(v.type)]);
      }
      default:
        throw new UnsupportedOp(x.op);
    }
  }
}

export class UnsupportedOp extends Error {
  constructor(readonly op: string) {
    super(`expression operator ${op} is not supported by compiler-code-rust`);
  }
}
