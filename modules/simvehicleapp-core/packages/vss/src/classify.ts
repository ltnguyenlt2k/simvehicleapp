import { SCALAR_TYPES, type NodeKind, type VehicleBlockType, type VssDataType, type VssScalarType } from "./types.ts";

const BLOCKS_BY_KIND: Readonly<Record<NodeKind, readonly VehicleBlockType[]>> = {
  branch: [],
  sensor: ["sv_read_signal", "sv_on_signal_changed"],
  actuator: ["sv_read_signal", "sv_on_signal_changed", "sv_set_actuator"],
  attribute: ["sv_read_attribute"],
};

/**
 * Vehicle blocks offered for a node (ADR-0010 §6). Array-typed actuators get no `sv_set_actuator`
 * (ADR-0018 §2: arrays are read-only in v1; none exist in VSS 4.0/4.2).
 */
export function blocksFor(node: { kind: NodeKind; datatype?: VssDataType }): readonly VehicleBlockType[] {
  const blocks = BLOCKS_BY_KIND[node.kind];
  if (node.kind === "actuator" && node.datatype && isArrayType(node.datatype)) {
    return blocks.filter((b) => b !== "sv_set_actuator");
  }
  return blocks;
}

const SCALARS: ReadonlySet<string> = new Set(SCALAR_TYPES);

export function isVssDataType(value: unknown): value is VssDataType {
  return typeof value === "string" && SCALARS.has(value.endsWith("[]") ? value.slice(0, -2) : value);
}

export function isArrayType(datatype: VssDataType): datatype is `${VssScalarType}[]` {
  return datatype.endsWith("[]");
}

/** Element type of an array type, or the type itself for scalars. */
export function elementType(datatype: VssDataType): VssScalarType {
  return (isArrayType(datatype) ? datatype.slice(0, -2) : datatype) as VssScalarType;
}

/** int64/uint64 values travel as decimal strings in JSON (ADR-0018 §7). */
export function is64BitInteger(type: VssScalarType): boolean {
  return type === "int64" || type === "uint64";
}
