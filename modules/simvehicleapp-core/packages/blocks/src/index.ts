import type { BlockSpecV1 } from "@simvehicleapp/contracts";
import type { VehicleBlockType } from "@simvehicleapp/vss";
import svArrayAt from "../sv_array_at/spec.json" with { type: "json" };
import svArrayContains from "../sv_array_contains/spec.json" with { type: "json" };
import svArrayLength from "../sv_array_length/spec.json" with { type: "json" };
import svBatteryStatus from "../sv_battery_status/spec.json" with { type: "json" };
import svBool from "../sv_bool/spec.json" with { type: "json" };
import svClamp from "../sv_clamp/spec.json" with { type: "json" };
import svClimateStatus from "../sv_climate_status/spec.json" with { type: "json" };
import svCompare from "../sv_compare/spec.json" with { type: "json" };
import svConstant from "../sv_constant/spec.json" with { type: "json" };
import svConvert from "../sv_convert/spec.json" with { type: "json" };
import svCounter from "../sv_counter/spec.json" with { type: "json" };
import svDoorStatus from "../sv_door_status/spec.json" with { type: "json" };
import svExpression from "../sv_expression/spec.json" with { type: "json" };
import svFilter from "../sv_filter/spec.json" with { type: "json" };
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
import svStateMachine from "../sv_state_machine/spec.json" with { type: "json" };
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
  svBatteryStatus,
  svBool,
  svClamp,
  svClimateStatus,
  svCompare,
  svConstant,
  svConvert,
  svCounter,
  svDoorStatus,
  svExpression,
  svFilter,
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
  svStateMachine,
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

export interface CompositeMember {
  output: string;
  /** VSS path with the block's placeholder props filled in. */
  path: string;
  /** The prop the path depends on (diagnostic field), when it has a `{prop}` placeholder. */
  prop?: string;
}

/** Member reads of a composite block (ADR-0045): `{prop}` placeholders replaced by the block's prop value or default. */
export function compositeMembers(spec: BlockSpec, props: Record<string, unknown>): CompositeMember[] {
  const value = (name: string) => {
    const v = props[name];
    return String(v === undefined || v === null || v === "" ? spec.props.find((p) => p.name === name)?.default : v);
  };
  return (spec.members ?? []).map((m) => {
    const prop = /\{([a-zA-Z0-9]+)\}/.exec(m.path)?.[1];
    return { output: m.output, path: m.path.replace(/\{([a-zA-Z0-9]+)\}/g, (_, name: string) => value(name)), ...(prop ? { prop } : {}) };
  });
}
