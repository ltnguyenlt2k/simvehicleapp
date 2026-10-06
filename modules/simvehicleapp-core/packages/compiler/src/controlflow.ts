import type { GraphBlock, WorkflowGraphV1 } from "@simvehicleapp/contracts";

/**
 * S6 control-flow analysis (analysis/06 §3, ADR-0012, ADR-0014): successors along edges, cycles,
 * reachability from triggers and dominators for `<block.output>` references.
 *
 * Containers are modelled conservatively: a container reaches its body entries (`*-start-source`)
 * and its continuation (`*-end-source`) directly, so body blocks never dominate what follows the
 * container — a while loop may run zero times and `join any` cancels the slower branches.
 */

export interface ControlFlow {
  /** Blocks in a cycle (each cycle once, block ids sorted); loops must use Repeat/While. */
  cycles: string[][];
  /** Blocks reachable from a trigger. */
  reachable: ReadonlySet<string>;
  /** True when every path from a trigger to `b` goes through `a` (a ≠ b). */
  dominates(a: string, b: string): boolean;
}

export function analyzeControlFlow(graph: WorkflowGraphV1, isTrigger: (b: GraphBlock) => boolean): ControlFlow {
  const ids = graph.blocks.map((b) => b.id).sort();
  const known = new Set(ids);
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of [...graph.edges].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (known.has(e.from) && known.has(e.to)) succ.get(e.from)!.push(e.to);
  }
  for (const list of succ.values()) list.sort();
  const triggers = graph.blocks.filter(isTrigger).map((b) => b.id).sort();

  // Cycles: Tarjan's strongly connected components (iterative, deterministic order).
  const cycles: string[][] = [];
  {
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    for (const root of ids) {
      if (idx.has(root)) continue;
      const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
      idx.set(root, index);
      low.set(root, index++);
      stack.push(root);
      onStack.add(root);
      while (work.length) {
        const top = work[work.length - 1]!;
        const next = succ.get(top.v)![top.i++];
        if (next !== undefined) {
          if (!idx.has(next)) {
            idx.set(next, index);
            low.set(next, index++);
            stack.push(next);
            onStack.add(next);
            work.push({ v: next, i: 0 });
          } else if (onStack.has(next)) {
            low.set(top.v, Math.min(low.get(top.v)!, idx.get(next)!));
          }
          continue;
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1]!.v;
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
        }
        if (low.get(top.v) === idx.get(top.v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== top.v);
          if (scc.length > 1 || succ.get(top.v)!.includes(top.v)) cycles.push(scc.sort());
        }
      }
    }
    cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  }

  // Reverse postorder from a virtual root that enters every trigger.
  const ROOT = "\u0000root";
  const order: string[] = [];
  const seen = new Set<string>([ROOT]);
  const rootSucc = triggers;
  const succOf = (v: string) => (v === ROOT ? rootSucc : succ.get(v)!);
  {
    const work: { v: string; i: number }[] = [{ v: ROOT, i: 0 }];
    while (work.length) {
      const top = work[work.length - 1]!;
      const next = succOf(top.v)[top.i++];
      if (next !== undefined) {
        if (!seen.has(next)) {
          seen.add(next);
          work.push({ v: next, i: 0 });
        }
        continue;
      }
      work.pop();
      order.push(top.v);
    }
  }
  const rpo = order.reverse();
  const reachable = new Set(rpo.filter((v) => v !== ROOT));

  // Dominators: Cooper, Harvey & Kennedy, "A Simple, Fast Dominance Algorithm".
  const pos = new Map(rpo.map((v, i) => [v, i]));
  const preds = new Map<string, string[]>();
  for (const v of rpo) for (const s of succOf(v)) if (pos.has(s)) preds.set(s, [...(preds.get(s) ?? []), v]);
  const idom = new Map<string, string>([[ROOT, ROOT]]);
  const intersect = (a: string, b: string) => {
    while (a !== b) {
      while (pos.get(a)! > pos.get(b)!) a = idom.get(a)!;
      while (pos.get(b)! > pos.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const v of rpo) {
      if (v === ROOT) continue;
      const ps = (preds.get(v) ?? []).filter((p) => idom.has(p));
      if (!ps.length) continue;
      let d = ps[0]!;
      for (const p of ps.slice(1)) d = intersect(p, d);
      if (idom.get(v) !== d) {
        idom.set(v, d);
        changed = true;
      }
    }
  }

  return {
    cycles,
    reachable,
    dominates(a, b) {
      if (a === b || !reachable.has(a) || !reachable.has(b)) return false;
      for (let v = idom.get(b); v !== undefined && v !== ROOT; v = idom.get(v)) if (v === a) return true;
      return false;
    },
  };
}
