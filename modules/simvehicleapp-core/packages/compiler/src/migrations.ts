import type { GraphBlock, WorkflowGraphV1 } from "@simvehicleapp/contracts";
import type { BlockSpec } from "@simvehicleapp/blocks";

/**
 * Block property migrations (analysis/06 §3 S2, ADR-0011 §4): a graph saved with an older
 * `blockVersion` is upgraded step by step to the BlockSpec version before it is checked or lowered,
 * so old workflows keep compiling to the same meaning. One function per (type, fromVersion).
 * No BlockSpec has changed version yet, so the registry is empty.
 */
export type Migration = (props: Readonly<Record<string, unknown>>) => Record<string, unknown>;
export type MigrationRegistry = Readonly<Record<string, Readonly<Record<number, Migration>>>>;

export const MIGRATIONS: MigrationRegistry = {};

export interface MigrationFailure {
  blockId: string;
  type: string;
  from: number;
  to: number;
  /** "newer": saved by a newer compiler; "no_path": an intermediate migration is missing. */
  reason: "newer" | "no_path";
}

/** Returns the graph with every block at its BlockSpec version, and the blocks that could not be migrated (left as they were). */
export function migrateGraph(
  graph: WorkflowGraphV1,
  specs: ReadonlyMap<string, BlockSpec>,
  registry: MigrationRegistry = MIGRATIONS,
): { graph: WorkflowGraphV1; failures: MigrationFailure[] } {
  const failures: MigrationFailure[] = [];
  const blocks = graph.blocks.map((b): GraphBlock => {
    const spec = specs.get(b.type);
    const from = b.blockVersion ?? 1;
    if (!spec || from === spec.version) return b;
    if (from > spec.version) {
      failures.push({ blockId: b.id, type: b.type, from, to: spec.version, reason: "newer" });
      return b;
    }
    let props = { ...(b.props as Record<string, unknown>) };
    for (let v = from; v < spec.version; v++) {
      const step = registry[b.type]?.[v];
      if (!step) {
        failures.push({ blockId: b.id, type: b.type, from, to: spec.version, reason: "no_path" });
        return b;
      }
      props = step(props);
    }
    return { ...b, props, blockVersion: spec.version } as GraphBlock;
  });
  return { graph: { ...graph, blocks }, failures };
}
