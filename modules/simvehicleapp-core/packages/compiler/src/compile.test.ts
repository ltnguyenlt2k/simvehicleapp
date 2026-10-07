import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { BLOCK_SPECS } from "@simvehicleapp/blocks";
import { ContractValidator, fixturesDir, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { parseVssRelease, type VssModel } from "@simvehicleapp/vss";
import { goldenIr, irFixtureDirs } from "./golden-ir.ts";
import { type CompileContext, compile, kebab, pascal } from "./index.ts";

const fixture = (rel: string) => `${fixturesDir}${rel}`;
const models: Record<string, VssModel> = {
  "v4.0": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.0.json"), "utf8")), "v4.0"),
  "v4.2": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.2.json"), "utf8")), "v4.2"),
};
export const ctx: CompileContext = {
  vehicle: async (release, paths) => new Map(paths.map((p) => [p, models[release]!.nodes.get(p) ?? null])),
  modelHash: async (release) => models[release]?.modelHash ?? null,
};
const corpus = (dir: string) =>
  readdirSync(fixture(dir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [`${dir}/${d.name}`, JSON.parse(readFileSync(fixture(`${dir}/${d.name}/graph.json`), "utf8")) as WorkflowGraphV1] as const)
    .sort();
const validator = new ContractValidator();

describe("compile: every golden and conformance graph builds a valid IR (M04-T08)", () => {
  for (const [id, graph] of [...corpus("golden"), ...corpus("conformance")]) {
    test(`${id}`, async () => {
      const r = await compile(graph, ctx);
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.ir).toBeDefined();
      const v = validator.validate("ir", r.ir);
      expect(v.errors).toEqual([]);
      // deterministic: same graph ⇒ same bytes
      expect(JSON.stringify((await compile(structuredClone(graph), ctx)).ir)).toBe(JSON.stringify(r.ir));
    });
  }
});

describe("compile: names", () => {
  test("PascalCase IR name and kebab-case app topic", () => {
    expect(pascal("Stable Overspeed Warning")).toBe("StableOverspeedWarning");
    expect(pascal("auto wipers 2")).toBe("AutoWipers2");
    expect(pascal("2 doors")).toBe("App2Doors");
    expect(pascal("—")).toBe("App");
    expect(kebab("Stable Overspeed Warning")).toBe("stable-overspeed-warning");
    expect(kebab("WelcomeSequence")).toBe("welcome-sequence");
  });
});

describe("golden IR snapshots (ADR-0014 Verification: diff = 0)", () => {
  for (const dir of irFixtureDirs()) {
    test(`${dir}/ir.json is what the compiler produces`, async () => {
      expect(await goldenIr(dir)).toBe(readFileSync(fixture(`${dir}/ir.json`), "utf8"));
    });
  }
});

describe("composite blocks (ADR-0045)", () => {
  const graph = (blocks: Record<string, unknown>[], edges: Record<string, unknown>[] = []) =>
    ({
      graphVersion: "1.0.0",
      workflowId: "composite",
      revision: 1,
      name: "Composite",
      vss: { release: "v4.2" },
      variables: [],
      blocks: blocks.map((b) => ({ parentId: null, blockVersion: 1, ...b })),
      edges: edges.map((e, i) => ({ id: `e${i}`, toHandle: "target", ...e })),
    }) as unknown as WorkflowGraphV1;
  const start = { id: "t", type: "sv_on_app_start", name: "start", props: {} };
  const log = (id: string, message: string) => ({ id, type: "sv_log", name: id, props: { level: "info", message } });

  test("placeholder prop and fresh-read apply to every member; outputs typed by their member signal", async () => {
    const g = graph(
      [start, { id: "c", type: "sv_climate_status", name: "climate", props: { station: "Row1.Passenger", source: "fresh-read" } }, log("l", "<climate.setTemperature> <climate.fanSpeed>")],
      [
        { from: "t", fromHandle: "source", to: "c" },
        { from: "c", fromHandle: "source", to: "l" },
      ],
    );
    const { ir, diagnostics } = await compile(g, ctx);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const nodes = (ir!.nodes as { id: string; opcode: string; args: Record<string, unknown>; next: Record<string, unknown>; src: Record<string, unknown> }[]).filter((n) => n.src.blockId === "c");
    const signals = new Map((ir!.signals as { id: string; path: string; access: string[] }[]).map((s) => [s.id, s]));
    expect(nodes.map((n) => signals.get(String(n.args.signal))!.path)).toEqual([
      "Vehicle.Cabin.HVAC.AmbientAirTemperature",
      "Vehicle.Exterior.AirTemperature",
      "Vehicle.Cabin.HVAC.Station.Row1.Passenger.Temperature",
      "Vehicle.Cabin.HVAC.Station.Row1.Passenger.FanSpeed",
      "Vehicle.Cabin.HVAC.IsAirConditioningActive",
    ]);
    expect(nodes.every((n) => n.opcode === "vehicle.read" && n.args.fresh === true)).toBe(true);
    expect(nodes.every((n) => signals.get(String(n.args.signal))!.access.join() === "read")).toBe(true);
    expect(nodes.map((n) => n.next.next)).toEqual([...nodes.slice(1).map((n) => n.id), expect.stringMatching(/^n[0-9]+$/)]);
    expect(nodes.map((n) => n.src.inserted === true)).toEqual([false, true, true, true, true]);
    const logNode = (ir!.nodes as { src: { blockId: string }; args: { message: { $template: unknown[] } } }[]).find((n) => n.src.blockId === "l")!;
    expect(JSON.stringify(logNode.args.message)).toContain(`"$ref":"${nodes[2]!.id}.value"`);
    expect(JSON.stringify(logNode.args.message)).toContain(`"$ref":"${nodes[3]!.id}.value"`);
  });

  test("the block's error handle is every member's error; the last member continues to `source`", async () => {
    const g = graph(
      [start, { id: "d", type: "sv_door_status", name: "door", props: { door: "Row2.PassengerSide" } }, log("ok", "open"), log("bad", "missing")],
      [
        { from: "t", fromHandle: "source", to: "d" },
        { from: "d", fromHandle: "source", to: "ok" },
        { from: "d", fromHandle: "error", to: "bad" },
      ],
    );
    const ir = (await compile(g, ctx)).ir!;
    const nodes = ir.nodes as { id: string; next: Record<string, string | null>; src: { blockId: string } }[];
    const id = (block: string) => nodes.find((n) => n.src.blockId === block)!.id;
    const door = nodes.filter((n) => n.src.blockId === "d");
    expect(door.map((n) => n.next.error)).toEqual([id("bad"), id("bad"), id("bad")]);
    expect(door.at(-1)!.next.next).toBe(id("ok"));
    // deterministic
    expect(JSON.stringify((await compile(structuredClone(g), ctx)).ir)).toBe(JSON.stringify(ir));
  });

  test("a member path missing from the release ⇒ VEHICLE_PATH_NOT_FOUND on the placeholder prop", async () => {
    const door = BLOCK_SPECS.find((s) => s.type === "sv_door_status")!;
    const props = door.props.map((p) => (p.name === "door" ? { ...p, enum: [...p.enum!, "Row3.DriverSide"] } : p)) as typeof door.props;
    const specs = BLOCK_SPECS.map((s) => (s === door ? { ...door, props } : s));
    const g = graph([start, { id: "d", type: "sv_door_status", name: "door", props: { door: "Row3.DriverSide" } }], [{ from: "t", fromHandle: "source", to: "d" }]);
    const { ir, diagnostics } = await compile(g, { ...ctx, specs });
    expect(ir).toBeUndefined();
    expect(diagnostics.filter((d) => d.code === "VEHICLE_PATH_NOT_FOUND").map((d) => [d.blockId, d.field, (d.data as { path?: string } | undefined)?.path])).toEqual([
      ["d", "door", "Vehicle.Cabin.Door.Row3.DriverSide.IsOpen"],
      ["d", "door", "Vehicle.Cabin.Door.Row3.DriverSide.IsLocked"],
      ["d", "door", "Vehicle.Cabin.Door.Row3.DriverSide.IsChildLockActive"],
    ]);
  });
});
