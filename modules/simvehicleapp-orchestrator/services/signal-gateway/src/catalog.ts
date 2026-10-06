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

/** Signals per release, loaded once from the catalog (a failed load is retried on the next call). */
export class Catalog {
  private readonly cache = new Map<string, Promise<Map<string, SignalMeta>>>();

  constructor(private readonly loadDocument: (release: string) => Promise<unknown>) {}

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
