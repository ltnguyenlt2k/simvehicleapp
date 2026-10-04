import type { Node } from "./ast.ts";

/**
 * Compact S-expression of an AST (no spans), e.g. `(&& (> <Vehicle.Speed> 120km/h) (! <variable.warn>))`.
 * Used by tests and diagnostics; stable across runs.
 */
export function toSexpr(node: Node): string {
  switch (node.type) {
    case "number":
      return node.unit ? `${node.raw}${node.unit}` : node.raw;
    case "string":
      return JSON.stringify(node.value);
    case "bool":
      return String(node.value);
    case "ref":
      return `<${node.path.join(".")}>`;
    case "template":
      return `(tpl ${node.parts.map((p) => (typeof p === "string" ? JSON.stringify(p) : toSexpr(p))).join(" ")})`;
    case "index":
      return `(at ${toSexpr(node.target)} ${toSexpr(node.index)})`;
    case "call":
      return `(${node.name}${node.args.map((a) => ` ${toSexpr(a)}`).join("")})`;
    case "unary":
      return `(${node.op === "-" ? "neg" : "!"} ${toSexpr(node.arg)})`;
    case "binary":
      return `(${node.op} ${toSexpr(node.left)} ${toSexpr(node.right)})`;
    case "ternary":
      return `(? ${toSexpr(node.cond)} ${toSexpr(node.then)} ${toSexpr(node.else)})`;
  }
}
