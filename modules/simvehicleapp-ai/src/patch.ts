/**
 * WorkflowPatch v1 (contracts `workflow-patch`, ADR-0030 §5) applied to a WorkflowGraph draft. The patch
 * never touches the saved workflow: the result is validated by the compiler and shown to the user, who
 * accepts it in the studio. Problems that make an op meaningless (unknown block, duplicate ref) are
 * reported; everything else (types, handles, units) is the compiler's job.
 */

export interface GraphBlock {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
  parentId?: string | null;
  blockVersion?: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  fromHandle: string;
  to: string;
  toHandle: string;
}

export interface WorkflowGraph {
  graphVersion: string;
  workflowId: string;
  revision?: number;
  name: string;
  vss: { release: string };
  variables?: unknown[];
  blocks: GraphBlock[];
  edges: GraphEdge[];
}

export type PatchOp =
  | { op: "add_block"; ref: string; type: string; name?: string; props: Record<string, unknown>; parentId?: string; position?: unknown }
  | { op: "connect"; from: string; fromHandle: string; to: string; toHandle?: string }
  | { op: "set_props"; block: string; props: Record<string, unknown> }
  | { op: "remove_block"; block: string };

export interface WorkflowPatch {
  patchVersion: string;
  workflowId: string;
  baseRevision: number;
  ops: PatchOp[];
  rationale?: string;
}

/** Sim/compiler block name normalization used in `<name.output>` references (ADR-0013 Notes). */
export const normalizeName = (name: string) => name.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");

const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;

export function emptyGraph(workflowId: string, name: string, release: string): WorkflowGraph {
  return { graphVersion: "1.0.0", workflowId, revision: 0, name, vss: { release }, variables: [], blocks: [], edges: [] };
}

/** Applies the ops in order on a copy of `base`; `titleOf` names blocks the patch leaves unnamed. */
export function applyPatch(base: WorkflowGraph, ops: readonly PatchOp[], titleOf: (type: string) => string = (t) => t): { graph: WorkflowGraph; problems: string[] } {
  const graph: WorkflowGraph = structuredClone(base);
  const problems: string[] = [];
  const has = (id: string) => graph.blocks.some((b) => b.id === id);
  const uniqueName = (wanted: string) => {
    const taken = new Set(graph.blocks.map((b) => normalizeName(b.name)));
    if (!taken.has(normalizeName(wanted))) return wanted;
    for (let n = 2; ; n++) if (!taken.has(normalizeName(`${wanted} ${n}`))) return `${wanted} ${n}`;
  };
  let edgeSeq = graph.edges.length;
  ops.forEach((op, i) => {
    const at = `ops[${i}] ${op.op}`;
    switch (op.op) {
      case "add_block": {
        if (!ID.test(op.ref ?? "")) return problems.push(`${at}: ref "${op.ref}" is not a valid id (letters, digits, _ . : -)`);
        if (has(op.ref)) return problems.push(`${at}: block ${op.ref} already exists — use another ref, or set_props to change it`);
        if (!/^sv_[a-z0-9_]+$/.test(op.type ?? "")) return problems.push(`${at}: type "${op.type}" is not a vehicle block (sv_…)`);
        if (op.parentId && !has(op.parentId)) return problems.push(`${at}: parent ${op.parentId} does not exist`);
        graph.blocks.push({ id: op.ref, type: op.type, name: uniqueName(op.name?.trim() || titleOf(op.type)), props: { ...(op.props ?? {}) }, parentId: op.parentId ?? null, blockVersion: 1 });
        return;
      }
      case "connect": {
        if (!has(op.from)) return problems.push(`${at}: block ${op.from} does not exist`);
        if (!has(op.to)) return problems.push(`${at}: block ${op.to} does not exist`);
        const toHandle = op.toHandle ?? "target";
        if (graph.edges.some((e) => e.from === op.from && e.fromHandle === op.fromHandle && e.to === op.to && e.toHandle === toHandle)) return;
        while (graph.edges.some((e) => e.id === `e${edgeSeq + 1}`)) edgeSeq++;
        graph.edges.push({ id: `e${++edgeSeq}`, from: op.from, fromHandle: op.fromHandle || "source", to: op.to, toHandle });
        return;
      }
      case "set_props": {
        const b = graph.blocks.find((x) => x.id === op.block);
        if (!b) return problems.push(`${at}: block ${op.block} does not exist`);
        b.props = { ...b.props, ...(op.props ?? {}) };
        return;
      }
      case "remove_block": {
        if (!has(op.block)) return problems.push(`${at}: block ${op.block} does not exist`);
        const gone = new Set([op.block]);
        // A container goes with its content.
        for (let grew = true; grew; ) {
          grew = false;
          for (const b of graph.blocks) if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) (gone.add(b.id), (grew = true));
        }
        graph.blocks = graph.blocks.filter((b) => !gone.has(b.id));
        graph.edges = graph.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
        return;
      }
      default:
        problems.push(`${at}: unknown op`);
    }
  });
  return { graph, problems };
}

/**
 * References written with a block's id or ref (`<t1.value>`) instead of its name are rewritten to the
 * normalized name (`<socchanged.value>`), in the ops' props: the compiler resolves names only. A token
 * that already is a block name, or a VSS path (`<Vehicle.…>`), is kept.
 */
/**
 * Operators of an expression as the language spells them: models HTML-escape them (`&amp;&amp;`,
 * `&gt;`) or use ≥ ≤ ≠. Only strings holding a reference (`<…>`, i.e. expressions/templates) change.
 */
export function asciiOperators(v: string): string {
  const escaped = v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  if (!/<[A-Za-z_][^<>]*>/.test(escaped)) return v;
  return escaped.replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/≠/g, "!=");
}

export function referencesByName(base: WorkflowGraph, ops: readonly PatchOp[], titleOf?: (type: string) => string): PatchOp[] {
  const { graph } = applyPatch(base, ops, titleOf);
  const names = new Set(graph.blocks.map((b) => normalizeName(b.name)));
  const byId = new Map(graph.blocks.map((b) => [b.id, normalizeName(b.name)]));
  const rewrite = (v: unknown): unknown => {
    if (typeof v === "string")
      return asciiOperators(v).replace(/<([A-Za-z0-9_][A-Za-z0-9_:-]*)\.(?=[A-Za-z_])/g, (all, token: string) => (names.has(token) || !byId.has(token) ? all : `<${byId.get(token)}.`));
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, rewrite(x)]));
    return v;
  };
  return ops.map((op) => (op.op === "add_block" || op.op === "set_props" ? ({ ...op, props: rewrite(op.props) } as PatchOp) : op));
}

/** What a patch changes, for the proposal card (added / changed / removed blocks). */
export function patchSummary(base: WorkflowGraph, graph: WorkflowGraph) {
  const before = new Map(base.blocks.map((b) => [b.id, b]));
  const after = new Map(graph.blocks.map((b) => [b.id, b]));
  return {
    added: graph.blocks.filter((b) => !before.has(b.id)).map((b) => ({ id: b.id, type: b.type, name: b.name })),
    changed: graph.blocks.filter((b) => before.has(b.id) && JSON.stringify(before.get(b.id)) !== JSON.stringify(b)).map((b) => ({ id: b.id, type: b.type, name: b.name })),
    removed: base.blocks.filter((b) => !after.has(b.id)).map((b) => ({ id: b.id, type: b.type, name: b.name })),
    edgesAdded: graph.edges.length - base.edges.filter((e) => graph.edges.some((x) => x.id === e.id)).length,
  };
}

/** Handles of a block type (BlockSpec `handles`); absent ⇒ Sim's default single handles. */
export interface HandleSpec {
  type: string;
  handles?: { in?: string[]; out?: string[] };
}

/**
 * Deterministic repairs of mistakes small models make, applied before validation and reported back
 * (the user sees the repaired patch): a connect into a trigger is reversed (triggers have no input),
 * and a connect from a handle the source does not have uses its only output handle (or then/else for
 * true/false). Nothing is guessed when more than one handle could be meant.
 */
export function repairOps(base: WorkflowGraph, opsIn: readonly PatchOp[], specs: readonly HandleSpec[], previous: readonly PatchOp[] = []): { ops: PatchOp[]; fixes: string[] } {
  const fixes: string[] = [];
  // Each proposal is the complete change, but models often send only what changed since their last
  // one: blocks referenced here and added by the previous proposal of the turn are added again.
  const known = new Set([...base.blocks.map((b) => b.id), ...opsIn.flatMap((o) => (o.op === "add_block" ? [o.ref] : []))]);
  const referenced = opsIn.flatMap((o) => (o.op === "connect" ? [o.from, o.to] : o.op === "set_props" || o.op === "remove_block" ? [o.block] : []));
  const carried = previous.filter((o): o is Extract<PatchOp, { op: "add_block" }> => o.op === "add_block" && referenced.includes(o.ref) && !known.has(o.ref));
  if (carried.length) fixes.push(`kept from your previous proposal: ${carried.map((o) => o.ref).join(", ")} (send the complete ops each time)`);
  // Blocks are added before they are connected or changed, whatever the order the model wrote.
  const all = [...carried, ...opsIn];
  const adds = all.filter((o) => o.op === "add_block");
  const firstOther = all.findIndex((o) => o.op !== "add_block");
  const outOfOrder = firstOther >= 0 && all.slice(firstOther).some((o) => o.op === "add_block");
  const ops = outOfOrder ? [...adds, ...all.filter((o) => o.op !== "add_block")] : all;
  if (ops !== all && !carried.length) fixes.push("add_block ops moved before the ops that use them");
  const typeOf = new Map(base.blocks.map((b) => [b.id, b.type]));
  for (const op of ops) if (op.op === "add_block") typeOf.set(op.ref, op.type);
  const outs = (id: string) => specs.find((s) => s.type === typeOf.get(id))?.handles?.out ?? ["source"];
  const isTrigger = (id: string) => (typeOf.get(id) ?? "").startsWith("sv_on_");
  const repaired = ops.map((op, i) => {
    if (op.op !== "connect") return op;
    let c = { ...op };
    if (isTrigger(c.to) && !isTrigger(c.from) && typeOf.has(c.from)) {
      c = { ...c, from: op.to, to: op.from, fromHandle: outs(op.to)[0] ?? "source" };
      delete c.toHandle;
      fixes.push(`ops[${i}] connect reversed: ${op.to} is a trigger (no input), so ${op.to} → ${op.from}`);
    }
    const available = outs(c.from);
    if (typeOf.has(c.from) && !available.includes(c.fromHandle)) {
      const alias: Record<string, string> = { true: "then", yes: "then", false: "else", no: "else" };
      const handle = available.length === 1 ? available[0] : available.find((h) => h === alias[c.fromHandle?.toLowerCase?.() ?? ""]);
      if (handle) {
        fixes.push(`ops[${i}] connect from ${c.from}: handle '${c.fromHandle}' does not exist, used '${handle}'`);
        c = { ...c, fromHandle: handle };
      }
    }
    const ins = specs.find((s) => s.type === typeOf.get(c.to))?.handles?.in ?? ["target"];
    if (c.toHandle && typeOf.has(c.to) && !ins.includes(c.toHandle) && ins.length === 1) {
      fixes.push(`ops[${i}] connect to ${c.to}: input '${c.toHandle}' does not exist, used '${ins[0]}'`);
      c = { ...c, toHandle: ins[0] };
    }
    return c;
  });
  return { ops: repaired, fixes };
}
