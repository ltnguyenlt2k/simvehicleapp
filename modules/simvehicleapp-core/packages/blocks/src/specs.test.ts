import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractValidator } from "@simvehicleapp/contracts";
import { blocksFor, parseVssRelease, type VssNode } from "@simvehicleapp/vss";
import { BLOCK_SPECS, compositeMembers, getBlockSpec, VEHICLE_BLOCK_TYPES } from "./index.ts";

const root = join(import.meta.dir, "..");
const dirs = readdirSync(root).filter((d) => d.startsWith("sv_") && statSync(join(root, d)).isDirectory()).sort();
const contracts = new ContractValidator();
const catalog = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@simvehicleapp/contracts/schemas/diagnostics-catalog.v1.json")), "utf8"));
const codes = new Set<string>((catalog.diagnostics ?? catalog.codes ?? []).map((d: { code: string }) => d.code));

test("every block folder is registered, sorted by type", () => {
  expect(BLOCK_SPECS.map((s) => s.type)).toEqual(dirs);
  expect(VEHICLE_BLOCK_TYPES.every((t) => dirs.includes(t))).toBe(true);
});

/** Branch handles of flow blocks (analysis/05 §2.5); containers use Sim subflow handle ids (M03-T10). */
const FLOW_HANDLES: Record<string, string[]> = {
  sv_if: ["then", "else"],
  sv_switch: ["case", "default"],
  sv_wait: ["source"],
  sv_wait_until: ["ok", "timeout"],
  sv_stable_for: ["stable", "broken"],
  sv_repeat: ["loop-start-source", "loop-end-source"],
  sv_while: ["loop-start-source", "loop-end-source"],
  sv_parallel: ["parallel-start-source", "parallel-end-source"],
  sv_stop: [],
};

describe.each(dirs)("%s", (dir) => {
  const spec = getBlockSpec(dir)!;

  test("spec.json is a valid BlockSpec v1 and folder name = type", () => {
    contracts.assert("block-spec", spec);
    expect(spec.type).toBe(dir);
  });

  test("semantics.md exists and names the opcode", () => {
    const md = readFileSync(join(root, dir, "semantics.md"), "utf8");
    expect(md).toContain(`\`${spec.opcode}\``);
    for (const p of spec.props) expect(md).toContain(`\`${p.name}\``);
  });

  test("defaults are valid for their prop", () => {
    for (const p of spec.props) {
      if (p.default === undefined) continue;
      if (p.kind === "enum") expect(p.enum).toContain(p.default as string);
      if (typeof p.default === "number" && p.min !== undefined) expect(p.default).toBeGreaterThanOrEqual(p.min);
    }
  });

  test("vehicle blocks bind a required `path` first; other blocks have no vss-path prop", () => {
    const isVehicle = (VEHICLE_BLOCK_TYPES as readonly string[]).includes(spec.type);
    if (isVehicle) expect(spec.props[0]).toEqual({ name: "path", kind: "vss-path", required: true });
    else {
      expect(spec.props.some((p) => p.kind === "vss-path")).toBe(false);
      expect(spec.vssKinds).toBeUndefined();
    }
  });

  test("triggers declare a concurrency default matching their `concurrency` prop (05 §3.2)", () => {
    const prop = spec.props.find((p) => p.name === "concurrency");
    if (spec.category !== "triggers" || spec.type === "sv_on_app_start") return;
    expect(prop?.default).toBe(spec.concurrencyDefault as string);
  });

  test("handles follow the Sim canvas (triggers: source; steps: target → source/error; flow: named branches)", () => {
    if (spec.category === "triggers") expect(spec.handles).toEqual({ in: [], out: ["source"] });
    else if (spec.category === "flow") {
      expect(spec.handles.in).toEqual(["target"]);
      expect(spec.handles.out).toEqual(FLOW_HANDLES[spec.type] ?? ["<missing in FLOW_HANDLES>"]);
      expect(spec.container === true).toBe(/^(loop|parallel)-start-source$/.test(spec.handles.out[0] ?? ""));
    } else expect(spec.handles).toEqual({ in: ["target"], out: ["source", "error"] });
  });
});

test("diagnostic codes referenced by semantics exist in the public catalog", () => {
  expect(codes.size).toBeGreaterThan(0);
  for (const dir of dirs) {
    for (const m of readFileSync(join(root, dir, "semantics.md"), "utf8").matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) {
      expect(codes).toContain(m[1]!);
    }
  }
});

test("vssKinds agree with @simvehicleapp/vss blocksFor on every VSS 4.0/4.2 node (ADR-0010 §6)", () => {
  for (const r of ["4.0", "4.2"]) {
    const doc = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/fixtures/vss/vss_rel_${r}.json`)), "utf8"));
    for (const node of parseVssRelease(doc, `v${r}`).nodes.values()) {
      if (node.kind === "branch") {
        expect(blocksFor(node)).toEqual([]);
        continue;
      }
      const bySpec = BLOCK_SPECS.filter((s) => s.vssKinds?.includes(node.kind as Exclude<VssNode["kind"], "branch">)).map((s) => s.type);
      expect([...blocksFor(node)].sort() as string[]).toEqual(bySpec);
    }
  }
});

test("composite blocks: members ⇔ $signal outputs, every placeholder value a signal in VSS 4.0 and 4.2 (ADR-0045)", () => {
  const composites = BLOCK_SPECS.filter((s) => s.category === "composite");
  expect(composites.map((s) => s.type)).toEqual(["sv_battery_status", "sv_climate_status", "sv_door_status"]);
  const models = ["4.0", "4.2"].map((r) =>
    parseVssRelease(JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/fixtures/vss/vss_rel_${r}.json`)), "utf8")), `v${r}`),
  );
  for (const spec of composites) {
    expect(spec.opcode).toBe("vehicle.read");
    expect(spec.members!.map((m) => m.output)).toEqual(spec.outputs.map((o) => o.name));
    for (const o of spec.outputs) expect(o.type).toBe("$signal");
    const placeholders = [...new Set(spec.members!.flatMap((m) => [...m.path.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((x) => x[1]!)))];
    const choices: Record<string, string>[] = [{}];
    for (const name of placeholders) {
      const prop = spec.props.find((p) => p.name === name);
      expect(prop?.kind).toBe("enum");
      const next = choices.flatMap((c) => (prop!.enum as string[]).map((v) => ({ ...c, [name]: v })));
      choices.splice(0, choices.length, ...next);
    }
    for (const choice of choices) {
      for (const model of models) {
        for (const { path } of compositeMembers(spec, choice)) expect(`${path} ${model.nodes.get(path)?.kind ?? "missing"}`).toMatch(/ (sensor|actuator)$/);
      }
    }
  }
});
