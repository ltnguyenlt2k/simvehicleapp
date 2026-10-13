/**
 * Signals of a VSS release (vss-catalog `GET /vss`): what the gateway may read and inject — only paths
 * of the release, with their datatype and limits (analysis/08 §4: no arbitrary path).
 */

export type VssType = "sensor" | "actuator" | "attribute";

export interface SignalMeta {
  path: string;
  type: VssType;
  datatype: string;
  unit?: string;
  min?: number;
  max?: number;
  allowed?: unknown[];
}

interface VssNode {
  type?: string;
  datatype?: string;
  unit?: string;
  min?: number;
  max?: number;
  allowed?: unknown[];
  children?: Record<string, VssNode>;
}

/** Leaf signals of a VSS JSON document (`{"Vehicle": {"type": "branch", "children": {…}}}`). */
export function indexVss(doc: unknown): Map<string, SignalMeta> {
  const out = new Map<string, SignalMeta>();
  const walk = (prefix: string, node: VssNode) => {
    if (node.children) {
      for (const [name, child] of Object.entries(node.children)) walk(`${prefix}.${name}`, child);
      return;
    }
    if ((node.type === "sensor" || node.type === "actuator" || node.type === "attribute") && node.datatype) {
      out.set(prefix, {
        path: prefix,
        type: node.type,
        datatype: node.datatype,
        ...(node.unit ? { unit: node.unit } : {}),
        ...(typeof node.min === "number" ? { min: node.min } : {}),
        ...(typeof node.max === "number" ? { max: node.max } : {}),
        ...(Array.isArray(node.allowed) ? { allowed: node.allowed } : {}),
      });
    }
  };
  for (const [root, node] of Object.entries((doc ?? {}) as Record<string, VssNode>)) walk(root, node);
  return out;
}

/**
 * Signals per release, loaded once from the catalog (a failed load is retried on the next call). A custom model
 * (`vX.Y-<name>`, ADR-0052) can gain signals while the gateway runs: `signalsWith` reloads a release once when a
 * requested path is missing, at most every `refreshMs` per release (an unknown path stays cheap to reject).
 */
export class Catalog {
  private readonly cache = new Map<string, Promise<Map<string, SignalMeta>>>();
  private readonly reloaded = new Map<string, number>();

  constructor(
    private readonly loadDocument: (release: string) => Promise<unknown>,
    private readonly opts: { refreshMs?: number; now?: () => number } = {},
  ) {}

  async signalsWith(release: string, paths: readonly string[]): Promise<Map<string, SignalMeta>> {
    const signals = await this.signals(release);
    if (paths.every((p) => signals.has(p))) return signals;
    const now = (this.opts.now ?? Date.now)();
    if (now - (this.reloaded.get(release) ?? Number.NEGATIVE_INFINITY) < (this.opts.refreshMs ?? 5000)) return signals;
    this.reloaded.set(release, now);
    this.cache.delete(release);
    return this.signals(release);
  }

  signals(release: string): Promise<Map<string, SignalMeta>> {
    let p = this.cache.get(release);
    if (!p) {
      p = this.loadDocument(release).then(indexVss);
      p.catch(() => this.cache.delete(release));
      this.cache.set(release, p);
    }
    return p;
  }
}
