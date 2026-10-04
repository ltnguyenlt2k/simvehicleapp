import { canonicalJson, sha256Hex } from "./canonical.ts";
import { elementType, is64BitInteger, isArrayType, isVssDataType } from "./classify.ts";
import {
  NODE_KINDS,
  type NodeKind,
  type VssDataType,
  type VssModel,
  type VssNode,
  type VssScalarType,
  type VssScalarValue,
  type VssValue,
} from "./types.ts";

export class VssParseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "VssParseError";
  }
}

const RELEASE = /^v[0-9]+\.[0-9]+$/;
const ROOT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const CHILD_NAME = /^[A-Za-z0-9_]+$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)$/;
const INT_RANGE: Readonly<Record<string, readonly [bigint, bigint]>> = {
  int8: [-(2n ** 7n), 2n ** 7n - 1n],
  int16: [-(2n ** 15n), 2n ** 15n - 1n],
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint8: [0n, 2n ** 8n - 1n],
  uint16: [0n, 2n ** 16n - 1n],
  uint32: [0n, 2n ** 32n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
};
const KINDS: ReadonlySet<string> = new Set(NODE_KINDS);
const TEXT_FIELDS = ["unit", "description", "comment", "deprecation", "uuid"] as const;

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse a flat VSS release JSON (`vss_rel_<x.y>.json`, as produced by vss-tools' JSON exporter).
 * Pure: takes the already-decoded document. Throws `VssParseError` on the first structural error
 * rather than dropping data (NFR-05).
 */
export function parseVssRelease(doc: unknown, release: string): VssModel {
  if (!RELEASE.test(release)) throw new VssParseError("", `release '${release}' must match ${RELEASE}`);
  if (!isObject(doc) || Object.keys(doc).length === 0) throw new VssParseError("", "document must be a non-empty object of root branches");

  const nodes = new Map<string, VssNode>();
  const children = new Map<string, string[]>();
  const counts: Record<NodeKind, number> = { branch: 0, sensor: 0, actuator: 0, attribute: 0 };

  const visit = (path: string, name: string, raw: unknown): void => {
    if (!isObject(raw)) throw new VssParseError(path, "node must be an object");
    const node = normalizeNode(path, name, raw);
    nodes.set(path, node);
    counts[node.kind]++;
    const kids = raw.children;
    if (node.kind !== "branch") {
      if (kids !== undefined) throw new VssParseError(path, `${node.kind} must not have children`);
      return;
    }
    if (kids === undefined) {
      children.set(path, []);
      return;
    }
    if (!isObject(kids)) throw new VssParseError(path, "children must be an object");
    const names = Object.keys(kids);
    children.set(
      path,
      names.map((n) => `${path}.${n}`),
    );
    for (const n of names) {
      if (!CHILD_NAME.test(n)) throw new VssParseError(path, `invalid child name '${n}'`);
      visit(`${path}.${n}`, n, kids[n]);
    }
  };

  const roots = Object.keys(doc);
  for (const root of roots) {
    if (!ROOT_NAME.test(root)) throw new VssParseError(root, "invalid root name");
    if (!isObject(doc[root]) || doc[root].type !== "branch") throw new VssParseError(root, "root must be a branch");
    visit(root, root, doc[root]);
  }

  return { release, roots, nodes, children, counts, modelHash: `sha256:${sha256Hex(canonicalJson(doc))}` };
}

function normalizeNode(path: string, name: string, raw: Raw): VssNode {
  const kind = raw.type;
  if (typeof kind !== "string" || !KINDS.has(kind)) throw new VssParseError(path, `unknown node type '${String(kind)}'`);
  const node: VssNode = { path, name, kind: kind as NodeKind };
  for (const field of TEXT_FIELDS) {
    const v = raw[field];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new VssParseError(path, `'${field}' must be a string`);
    node[field] = v;
  }
  if (node.kind === "branch") return node;

  const datatype = raw.datatype;
  if (!isVssDataType(datatype)) throw new VssParseError(path, `unknown datatype '${String(datatype)}'`);
  node.datatype = datatype;
  for (const bound of ["min", "max"] as const) {
    const v = raw[bound];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new VssParseError(path, `'${bound}' must be a finite number`);
    node[bound] = v;
  }
  const scalar = elementType(datatype);
  if (raw.allowed !== undefined) {
    if (!Array.isArray(raw.allowed) || raw.allowed.length === 0) throw new VssParseError(path, "'allowed' must be a non-empty array");
    node.allowed = raw.allowed.map((v, i) => scalarValue(`${path}.allowed[${i}]`, scalar, v));
  }
  if (raw.default !== undefined) node.default = value(`${path}.default`, datatype, raw.default);
  return node;
}

function value(path: string, datatype: VssDataType, v: unknown): VssValue {
  const scalar = elementType(datatype);
  if (!isArrayType(datatype)) return scalarValue(path, scalar, v);
  if (!Array.isArray(v)) throw new VssParseError(path, `expected an array for ${datatype}`);
  return v.map((e, i) => scalarValue(`${path}[${i}]`, scalar, e));
}

/** Checks a value against its scalar type; int64/uint64 become decimal strings (ADR-0018 §7). */
function scalarValue(path: string, type: VssScalarType, v: unknown): VssScalarValue {
  if (type === "boolean") {
    if (typeof v !== "boolean") throw new VssParseError(path, "expected a boolean");
    return v;
  }
  if (type === "string") {
    if (typeof v !== "string") throw new VssParseError(path, "expected a string");
    return v;
  }
  if (type === "float" || type === "double") {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new VssParseError(path, `expected a number for ${type}`);
    return v;
  }
  const [lo, hi] = INT_RANGE[type]!;
  let n: bigint;
  if (typeof v === "number" && Number.isSafeInteger(v)) n = BigInt(v);
  else if (typeof v === "string" && is64BitInteger(type) && DECIMAL.test(v)) n = BigInt(v);
  else throw new VssParseError(path, `expected an exactly representable ${type} integer, got ${JSON.stringify(v)}`);
  if (n < lo || n > hi) throw new VssParseError(path, `${n} is out of range for ${type}`);
  return is64BitInteger(type) ? n.toString() : Number(n);
}
