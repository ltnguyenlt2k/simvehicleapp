/** Node kinds of a VSS tree (ADR-0010 §5); `kind` is the `type` key of the release JSON. */
export const NODE_KINDS = ["branch", "sensor", "actuator", "attribute"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** The 12 COVESA scalar datatypes (ADR-0018 §1, contracts `common#/$defs/vssScalarType`). */
export const SCALAR_TYPES = [
  "boolean",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float",
  "double",
  "string",
] as const;
export type VssScalarType = (typeof SCALAR_TYPES)[number];
/** A scalar type or its variable-length array form (contracts `common#/$defs/vssDataType`). */
export type VssDataType = VssScalarType | `${VssScalarType}[]`;

/** Scalar value as carried in JSON; int64/uint64 are decimal strings (ADR-0018 §7). */
export type VssScalarValue = string | number | boolean;
export type VssValue = VssScalarValue | VssScalarValue[];

/** Normalized node, shape of `VssNode` in `openapi/vss-catalog.v1.yaml`. Absent fields are omitted. */
export interface VssNode {
  path: string;
  name: string;
  kind: NodeKind;
  datatype?: VssDataType;
  unit?: string;
  min?: number;
  max?: number;
  allowed?: VssScalarValue[];
  default?: VssValue;
  description?: string;
  comment?: string;
  deprecation?: string;
  uuid?: string;
}

/** Block types a signal can be placed in (ADR-0010 §6, ADR-0011 §1). */
export type VehicleBlockType = "sv_read_signal" | "sv_on_signal_changed" | "sv_set_actuator" | "sv_read_attribute";

/** A parsed release. Iteration order of `nodes` and `children` is the release file order (depth first). */
export interface VssModel {
  release: string;
  /** Top-level branch names, usually `["Vehicle"]`. */
  roots: readonly string[];
  nodes: ReadonlyMap<string, VssNode>;
  children: ReadonlyMap<string, readonly string[]>;
  counts: Readonly<Record<NodeKind, number>>;
  /** `sha256:<hex>` (contracts `common#/$defs/sha256`) of the canonical sorted-keys JSON of the release document (ADR-0010 §3). */
  modelHash: string;
}
