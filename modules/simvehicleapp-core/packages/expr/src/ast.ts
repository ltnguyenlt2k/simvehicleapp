/** Half-open character range `[start, end)` in the expression source. */
export interface Span {
  start: number
  end: number
}

/**
 * Reference kinds (ADR-0013 §1 + Notes 2026-10-04): `vehicle` = `<Vehicle.…>` (case-sensitive VSS path),
 * `variable`/`loop`/`parallel` = Sim prefixes, `block` = `<normalizedblockname.field…>`.
 */
export type RefKind = "block" | "vehicle" | "variable" | "loop" | "parallel";

export type Node =
  | NumberLit
  | StringLit
  | BoolLit
  | TemplateLit
  | RefExpr
  | IndexExpr
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | TernaryExpr;

/** `raw` keeps the exact decimal text (no float rounding, int64-safe, ADR-0018 §7). */
export interface NumberLit {
  type: "number";
  raw: string;
  unit?: string;
  span: Span;
}

export interface StringLit {
  type: "string";
  value: string;
  span: Span;
}

export interface BoolLit {
  type: "bool";
  value: boolean;
  span: Span;
}

/** `"Speed {<Vehicle.Speed>} km/h"`: alternating text parts and embedded expressions (M03-T03). */
export interface TemplateLit {
  type: "template";
  parts: (string | Node)[];
  span: Span;
}

export interface RefExpr {
  type: "ref";
  kind: RefKind;
  /** Segments inside `<…>`, e.g. `["Vehicle", "Speed"]` or `["readspeed1", "value"]`. */
  path: string[];
  span: Span;
}

export interface IndexExpr {
  type: "index";
  target: Node;
  index: Node;
  span: Span;
}

export interface CallExpr {
  type: "call";
  name: string;
  args: Node[];
  span: Span;
}

export type UnaryOp = "-" | "!";
export interface UnaryExpr {
  type: "unary";
  op: UnaryOp;
  arg: Node;
  span: Span;
}

export type BinaryOp = "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";
export interface BinaryExpr {
  type: "binary";
  op: BinaryOp;
  left: Node;
  right: Node;
  span: Span;
}

export interface TernaryExpr {
  type: "ternary";
  cond: Node;
  then: Node;
  else: Node;
  span: Span;
}
