import type { Node, RefExpr, RefKind, Span } from "./ast.ts";

/** What a resolver knows about a referenced value; types/units are checked by the typer (ADR-0015, M4). */
export interface ResolvedRef {
  /** contracts `common#/$defs/valueType` (e.g. `float`, `string[]`, `timestamp`) when known. */
  valueType?: string;
  unit?: string | null;
}

/**
 * Looks references up (ADR-0013 §1). Implementations: the compiler (block outputs that dominate the
 * use, the VSS catalog, workflow variables, enclosing loop/parallel), the studio lint and tests.
 * Return `undefined` for "does not exist"; `field` is the dotted path after the first segment.
 */
export interface RefResolver {
  block(name: string, field: string[]): ResolvedRef | undefined | "unknown-block";
  vehicle(path: string): ResolvedRef | undefined;
  variable(name: string): ResolvedRef | undefined;
  /** `loop.index` / `parallel.currentItem` …; `undefined` when no such container encloses the block. */
  container(kind: "loop" | "parallel", field: string): ResolvedRef | undefined;
}

export type RefErrorReason =
  | "unknown_block"
  | "unknown_field"
  | "unknown_signal"
  | "unknown_variable"
  | "unknown_container_field"
  | "reserved_name";

export interface RefError {
  code: "EXPR_UNKNOWN_REF";
  reason: RefErrorReason;
  message: string;
  span: Span;
  ref: string;
}

export interface RefCheck {
  ref: RefExpr;
  resolved?: ResolvedRef;
}

/** Depth-first, left-to-right visit of every node (template parts included). */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.type) {
    case "template":
      for (const p of node.parts) if (typeof p !== "string") walk(p, visit);
      break;
    case "index":
      walk(node.target, visit);
      walk(node.index, visit);
      break;
    case "call":
      for (const a of node.args) walk(a, visit);
      break;
    case "unary":
      walk(node.arg, visit);
      break;
    case "binary":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case "ternary":
      walk(node.cond, visit);
      walk(node.then, visit);
      walk(node.else, visit);
      break;
    default:
      break;
  }
}

/** Every `<…>` in source order (duplicates kept, so each use gets its own diagnostic span). */
export function collectRefs(ast: Node): RefExpr[] {
  const refs: RefExpr[] = [];
  walk(ast, (n) => {
    if (n.type === "ref") refs.push(n);
  });
  return refs;
}

const label = (r: RefExpr) => `<${r.path.join(".")}>`;

function resolveOne(ref: RefExpr, resolver: RefResolver): ResolvedRef | RefError {
  const [head, ...rest] = ref.path as [string, ...string[]];
  const err = (reason: RefErrorReason, message: string): RefError => ({
    code: "EXPR_UNKNOWN_REF",
    reason,
    message,
    span: ref.span,
    ref: label(ref),
  });
  const kind: RefKind = ref.kind;
  switch (kind) {
    case "vehicle":
      return resolver.vehicle(ref.path.join(".")) ?? err("unknown_signal", `${label(ref)} is not a signal of the workflow's VSS release`);
    case "variable":
      return resolver.variable(rest.join(".")) ?? err("unknown_variable", `Workflow variable '${rest.join(".")}' is not declared`);
    case "loop":
    case "parallel":
      return (
        resolver.container(kind, rest.join(".")) ??
        err("unknown_container_field", `${label(ref)} is only available inside a ${kind === "loop" ? "repeat/while" : "parallel"} block`)
      );
    case "block": {
      if (head === "vehicle") {
        // ADR-0013 Notes 2026-10-04: `Vehicle.` is reserved for VSS signals.
        return err("reserved_name", `'vehicle' is reserved: write VSS signals as <Vehicle.${rest.join(".")}> (capital V)`);
      }
      const r = resolver.block(head, rest);
      if (r === "unknown-block") return err("unknown_block", `No block named '${head}' runs before this one`);
      return r ?? err("unknown_field", `Block '${head}' has no output '${rest.join(".")}'`);
    }
  }
}

/**
 * Resolves every reference of `ast`. Returns one entry per reference (with what the resolver knows)
 * and one `EXPR_UNKNOWN_REF` error per unresolved use, in source order.
 */
export function checkRefs(ast: Node, resolver: RefResolver): { refs: RefCheck[]; errors: RefError[] } {
  const refs: RefCheck[] = [];
  const errors: RefError[] = [];
  for (const ref of collectRefs(ast)) {
    const r = resolveOne(ref, resolver);
    if ("code" in r) {
      errors.push(r);
      refs.push({ ref });
    } else refs.push({ ref, resolved: r });
  }
  return { refs, errors };
}
