import type { BlockSpecV1 } from "@simvehicleapp/contracts";
import type { VehicleBlockType } from "@simvehicleapp/vss";
import svArrayAt from "../sv_array_at/spec.json" with { type: "json" };
import svArrayContains from "../sv_array_contains/spec.json" with { type: "json" };
import svArrayLength from "../sv_array_length/spec.json" with { type: "json" };
import svBool from "../sv_bool/spec.json" with { type: "json" };
import svClamp from "../sv_clamp/spec.json" with { type: "json" };
import svCompare from "../sv_compare/spec.json" with { type: "json" };
import svConstant from "../sv_constant/spec.json" with { type: "json" };
import svConvert from "../sv_convert/spec.json" with { type: "json" };
import svCounter from "../sv_counter/spec.json" with { type: "json" };
import svExpression from "../sv_expression/spec.json" with { type: "json" };
import svHmiNotify from "../sv_hmi_notify/spec.json" with { type: "json" };
import svIf from "../sv_if/spec.json" with { type: "json" };
import svInRange from "../sv_in_range/spec.json" with { type: "json" };
import svLog from "../sv_log/spec.json" with { type: "json" };
import svLookup from "../sv_lookup/spec.json" with { type: "json" };
import svMath from "../sv_math/spec.json" with { type: "json" };
import svMqttPublish from "../sv_mqtt_publish/spec.json" with { type: "json" };
import svOnAppStart from "../sv_on_app_start/spec.json" with { type: "json" };
import svOnCondition from "../sv_on_condition/spec.json" with { type: "json" };
import svOnMqtt from "../sv_on_mqtt/spec.json" with { type: "json" };
import svOnSignalChanged from "../sv_on_signal_changed/spec.json" with { type: "json" };
import svOnTimer from "../sv_on_timer/spec.json" with { type: "json" };
import svParallel from "../sv_parallel/spec.json" with { type: "json" };
import svReadAttribute from "../sv_read_attribute/spec.json" with { type: "json" };
import svReadSignal from "../sv_read_signal/spec.json" with { type: "json" };
import svRepeat from "../sv_repeat/spec.json" with { type: "json" };
import svScale from "../sv_scale/spec.json" with { type: "json" };
import svSetActuator from "../sv_set_actuator/spec.json" with { type: "json" };
import svStableFor from "../sv_stable_for/spec.json" with { type: "json" };
import svStop from "../sv_stop/spec.json" with { type: "json" };
import svSwitch from "../sv_switch/spec.json" with { type: "json" };
import svVarGet from "../sv_var_get/spec.json" with { type: "json" };
import svVarSet from "../sv_var_set/spec.json" with { type: "json" };
import svWait from "../sv_wait/spec.json" with { type: "json" };
import svWaitUntil from "../sv_wait_until/spec.json" with { type: "json" };
import svWhile from "../sv_while/spec.json" with { type: "json" };

export type BlockSpec = BlockSpecV1;

const ALL = [
  svArrayAt,
  svArrayContains,
  svArrayLength,
  svBool,
  svClamp,
  svCompare,
  svConstant,
  svConvert,
  svCounter,
  svExpression,
  svHmiNotify,
  svIf,
  svInRange,
  svLog,
  svLookup,
  svMath,
  svMqttPublish,
  svOnAppStart,
  svOnCondition,
  svOnMqtt,
  svOnSignalChanged,
  svOnTimer,
  svParallel,
  svReadAttribute,
  svReadSignal,
  svRepeat,
  svScale,
  svSetActuator,
  svStableFor,
  svStop,
  svSwitch,
  svVarGet,
  svVarSet,
  svWait,
  svWaitUntil,
  svWhile,
] as BlockSpec[];

/** Every BlockSpec, sorted by `type` (stable order for `GET /blocks`). Specs are validated by tests, not at runtime. */
export const BLOCK_SPECS: readonly BlockSpec[] = [...ALL].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

const BY_TYPE: ReadonlyMap<string, BlockSpec> = new Map(BLOCK_SPECS.map((s) => [s.type, s]));

export function getBlockSpec(type: string): BlockSpec | undefined {
  return BY_TYPE.get(type);
}

/** The four VSS-bound blocks of M2 (ADR-0011 §1); the same set `@simvehicleapp/vss` `blocksFor` returns. */
export const VEHICLE_BLOCK_TYPES: readonly VehicleBlockType[] = ["sv_on_signal_changed", "sv_read_attribute", "sv_read_signal", "sv_set_actuator"];
