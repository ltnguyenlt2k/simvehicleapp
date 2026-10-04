import type { NodeKind, VssModel, VssNode } from "./types.ts";

export interface SearchOptions {
  kind?: NodeKind;
  /** Default 50, max 500. */
  limit?: number;
}

export interface SearchHit {
  node: VssNode;
  score: number;
}

export interface SearchIndex {
  search(query: string, options?: SearchOptions): SearchHit[];
}

/** Words that do not have to match (they still count for the phrase bonus). */
const STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "is", "of", "on", "or", "the", "to"]);

/** `StateOfCharge.Current` → `state of charge current`; `ADAS.ABS` → `adas abs`; `Row1` → `row 1`. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Levenshtein distance ≤ 1 (one substitution, insertion or deletion). */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

interface Entry {
  node: VssNode;
  name: string[];
  path: string[];
  description: string[];
  compactName: string;
  compactPath: string;
  depth: number;
}

const FIELD_WEIGHT = { name: 30, path: 10, description: 3 } as const;

function tokenScore(q: string, tokens: readonly string[], weight: number): number {
  let best = 0;
  for (const t of tokens) {
    if (t === q) return weight;
    if (t.startsWith(q)) best = Math.max(best, weight * 0.6);
    else if (q.length >= 4 && withinOneEdit(q, t)) best = Math.max(best, weight * 0.4);
  }
  return best;
}

/**
 * In-memory search over path, name and description (ADR-0010 §4). Pure and deterministic: same
 * model and query ⇒ same hits in the same order (score desc, then depth, then path).
 * The root branches are not searchable (they are not valid `vssPath`s).
 */
export function buildSearchIndex(model: VssModel): SearchIndex {
  const entries: Entry[] = [];
  for (const node of model.nodes.values()) {
    if (model.roots.includes(node.path)) continue;
    entries.push({
      node,
      name: tokenize(node.name),
      path: tokenize(node.path),
      description: tokenize(node.description ?? ""),
      compactName: compact(node.name),
      compactPath: compact(node.path),
      depth: node.path.split(".").length,
    });
  }

  return {
    search(query, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
      const all = tokenize(query);
      const required = all.filter((t) => !STOPWORDS.has(t));
      if (required.length === 0) return [];
      const phrase = all.join("");
      const exactPath = query.trim().toLowerCase();

      const hits: (SearchHit & { depth: number })[] = [];
      for (const e of entries) {
        if (options.kind && e.node.kind !== options.kind) continue;
        let score = 0;
        let matchedAll = true;
        for (const q of required) {
          const s = Math.max(
            tokenScore(q, e.name, FIELD_WEIGHT.name),
            tokenScore(q, e.path, FIELD_WEIGHT.path),
            tokenScore(q, e.description, FIELD_WEIGHT.description),
          );
          if (s === 0) {
            matchedAll = false;
            break;
          }
          score += s;
        }
        if (!matchedAll) continue;
        if (e.node.path.toLowerCase() === exactPath) score += 1000;
        if (e.compactName === phrase) score += 60;
        else if (all.length > 1 && e.compactPath.includes(phrase)) score += 40;
        if (e.node.kind !== "branch") score += 1;
        hits.push({ node: e.node, score: Math.round(score * 10) / 10, depth: e.depth });
      }
      hits.sort((a, b) => b.score - a.score || a.depth - b.depth || (a.node.path < b.node.path ? -1 : a.node.path > b.node.path ? 1 : 0));
      return hits.slice(0, limit).map(({ node, score }) => ({ node, score }));
    },
  };
}
