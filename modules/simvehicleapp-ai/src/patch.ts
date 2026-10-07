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
export function referencesByName(base: WorkflowGraph, ops: readonly PatchOp[], titleOf?: (type: string) => string): PatchOp[] {
  const { graph } = applyPatch(base, ops, titleOf);
  const names = new Set(graph.blocks.map((b) => normalizeName(b.name)));
  const byId = new Map(graph.blocks.map((b) => [b.id, normalizeName(b.name)]));
  const rewrite = (v: unknown): unknown => {
    if (typeof v === "string")
      return v.replace(/<([A-Za-z0-9_][A-Za-z0-9_:-]*)\.(?=[A-Za-z_])/g, (all, token: string) => (names.has(token) || !byId.has(token) ? all : `<${byId.get(token)}.`));
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
