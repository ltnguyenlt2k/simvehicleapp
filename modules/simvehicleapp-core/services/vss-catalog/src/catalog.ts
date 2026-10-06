import {
  buildSearchIndex,
  compareReleases,
  parseVssRelease,
  type NodeKind,
  type SearchIndex,
  type VehicleModelSource,
  type VssModel,
  type VssNode,
} from "@simvehicleapp/vss";

/** A node as served on the wire: `VssNode` plus `hasChildren` for branches cut off by `depth`. */
export type WireNode = VssNode & { hasChildren?: boolean };

export interface LoadedRelease {
  model: VssModel;
  index: SearchIndex;
  origin: string;
  /** The release document as JSON text (vendored into projects, `GET /vss`). */
  documentJson: string;
}

export class UnknownReleaseError extends Error {
  constructor(readonly release: string) {
    super(`unknown release ${release}`);
    this.name = "UnknownReleaseError";
  }
}

export class UnknownPathError extends Error {
  constructor(readonly path: string) {
    super(`unknown path ${path}`);
    this.name = "UnknownPathError";
  }
}

/**
 * Parsed releases cached in memory (ADR-0010 §7). A release is parsed at most once per process;
 * concurrent first requests share the same promise, and a failed load is not cached.
 */
export class Catalog {
  private readonly loaded = new Map<string, Promise<LoadedRelease>>();

  constructor(
    private readonly source: VehicleModelSource,
    readonly defaultRelease: string,
  ) {}

  async releases(): Promise<{ release: string; default?: boolean }[]> {
    const list = await this.source.releases();
    if (!list.includes(this.defaultRelease)) list.push(this.defaultRelease);
    return list.sort(compareReleases).map((release) => (release === this.defaultRelease ? { release, default: true } : { release }));
  }

  get(release: string = this.defaultRelease): Promise<LoadedRelease> {
    let p = this.loaded.get(release);
    if (!p) {
      p = this.load(release);
      this.loaded.set(release, p);
      p.catch(() => this.loaded.delete(release));
    }
    return p;
  }

  private async load(release: string): Promise<LoadedRelease> {
    const files = await this.source.load(release);
    if (!files) throw new UnknownReleaseError(release);
    const model = parseVssRelease(files.document, release);
    return { model, index: buildSearchIndex(model), origin: files.origin, documentJson: JSON.stringify(files.document) };
  }
}

/**
 * Lazy tree (ADR-0010 §4): the descendants of `prefix` down to `depth` levels, depth first in release
 * order. Without `prefix` the tree starts below the root branches, because a root alone is not a
 * valid `vssPath`. Branches whose children are beyond `depth` carry `hasChildren: true`.
 */
export function tree(model: VssModel, prefix: string | undefined, depth: number): WireNode[] {
  let starts: readonly string[];
  if (prefix === undefined) starts = model.roots.flatMap((r) => model.children.get(r) ?? []);
  else {
    if (!model.nodes.has(prefix)) throw new UnknownPathError(prefix);
    starts = model.children.get(prefix) ?? [];
  }
  const out: WireNode[] = [];
  const walk = (path: string, level: number) => {
    const node = model.nodes.get(path)!;
    const kids = model.children.get(path) ?? [];
    if (level === depth) {
      out.push(node.kind === "branch" && kids.length > 0 ? { ...node, hasChildren: true } : node);
      return;
    }
    out.push(node);
    for (const k of kids) walk(k, level + 1);
  };
  for (const s of starts) walk(s, 1);
  return out;
}

/** Batch lookup in request order; unknown paths are reported, not silently dropped. */
export function lookup(model: VssModel, paths: readonly string[]): { nodes: VssNode[]; unknown: string[] } {
  const nodes: VssNode[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const n = model.roots.includes(p) ? undefined : model.nodes.get(p);
    if (n) nodes.push(n);
    else unknown.push(p);
  }
  return { nodes, unknown };
}

export const SEARCH_LIMIT = 50;

export function search(loaded: LoadedRelease, q: string, kind: NodeKind | undefined): VssNode[] {
  return loaded.index.search(q, { kind, limit: SEARCH_LIMIT }).map((h) => h.node);
}
