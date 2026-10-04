import type { BlockSpecV1 } from "@simvehicleapp/contracts";
import type { VehicleBlockType } from "@simvehicleapp/vss";
import onSignalChanged from "../sv_on_signal_changed/spec.json" with { type: "json" };
import readAttribute from "../sv_read_attribute/spec.json" with { type: "json" };
import readSignal from "../sv_read_signal/spec.json" with { type: "json" };
import setActuator from "../sv_set_actuator/spec.json" with { type: "json" };

export type BlockSpec = BlockSpecV1;

/** Every BlockSpec, sorted by `type` (stable order for `GET /blocks`). Specs are validated by tests, not at runtime. */
export const BLOCK_SPECS: readonly BlockSpec[] = ([onSignalChanged, readAttribute, readSignal, setActuator] as BlockSpec[]).sort((a, b) =>
  a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
);

const BY_TYPE: ReadonlyMap<string, BlockSpec> = new Map(BLOCK_SPECS.map((s) => [s.type, s]));

export function getBlockSpec(type: string): BlockSpec | undefined {
  return BY_TYPE.get(type);
}

/** The four VSS-bound blocks of M2 (ADR-0011 §1); the same set `@simvehicleapp/vss` `blocksFor` returns. */
export const VEHICLE_BLOCK_TYPES: readonly VehicleBlockType[] = ["sv_on_signal_changed", "sv_read_attribute", "sv_read_signal", "sv_set_actuator"];
