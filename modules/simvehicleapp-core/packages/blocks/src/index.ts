import type { BlockSpecV1 } from "@simvehicleapp/contracts";
import type { VehicleBlockType } from "@simvehicleapp/vss";
import arrayAt from "../sv_array_at/spec.json" with { type: "json" };
import arrayContains from "../sv_array_contains/spec.json" with { type: "json" };
import arrayLength from "../sv_array_length/spec.json" with { type: "json" };
import bool from "../sv_bool/spec.json" with { type: "json" };
import clamp from "../sv_clamp/spec.json" with { type: "json" };
import compare from "../sv_compare/spec.json" with { type: "json" };
import constant from "../sv_constant/spec.json" with { type: "json" };
import convert from "../sv_convert/spec.json" with { type: "json" };
import expression from "../sv_expression/spec.json" with { type: "json" };
import inRange from "../sv_in_range/spec.json" with { type: "json" };
import lookup from "../sv_lookup/spec.json" with { type: "json" };
import math from "../sv_math/spec.json" with { type: "json" };
import onAppStart from "../sv_on_app_start/spec.json" with { type: "json" };
import onCondition from "../sv_on_condition/spec.json" with { type: "json" };
import onMqtt from "../sv_on_mqtt/spec.json" with { type: "json" };
import onSignalChanged from "../sv_on_signal_changed/spec.json" with { type: "json" };
import onTimer from "../sv_on_timer/spec.json" with { type: "json" };
import readAttribute from "../sv_read_attribute/spec.json" with { type: "json" };
import readSignal from "../sv_read_signal/spec.json" with { type: "json" };
import scale from "../sv_scale/spec.json" with { type: "json" };
import setActuator from "../sv_set_actuator/spec.json" with { type: "json" };

export type BlockSpec = BlockSpecV1;

/** Every BlockSpec, sorted by `type` (stable order for `GET /blocks`). Specs are validated by tests, not at runtime. */
export const BLOCK_SPECS: readonly BlockSpec[] = ([arrayAt, arrayContains, arrayLength, bool, clamp, compare, constant, convert, expression, inRange, lookup, math, onAppStart, onCondition, onMqtt, onSignalChanged, onTimer, readAttribute, readSignal, scale, setActuator] as BlockSpec[]).sort((a, b) =>
  a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
);

const BY_TYPE: ReadonlyMap<string, BlockSpec> = new Map(BLOCK_SPECS.map((s) => [s.type, s]));

export function getBlockSpec(type: string): BlockSpec | undefined {
  return BY_TYPE.get(type);
}

/** The four VSS-bound blocks of M2 (ADR-0011 §1); the same set `@simvehicleapp/vss` `blocksFor` returns. */
export const VEHICLE_BLOCK_TYPES: readonly VehicleBlockType[] = ["sv_on_signal_changed", "sv_read_attribute", "sv_read_signal", "sv_set_actuator"];
