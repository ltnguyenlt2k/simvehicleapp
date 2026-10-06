import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { createBackendHandler } from "./app.ts";
import { overlayBundle, runtimeBundle } from "./bundle.ts";
import { cppString, pascalCase, sanitizeIdent, snakeCase } from "./cpp.ts";
import { OPCODES } from "./emit.ts";
import { generate } from "./generate.ts";
import { manifestFragment, rawString } from "./project.ts";

/**
 * Golden C++ (ADR-0022 Verification: diff = 0), determinism, contract shapes and error paths of
 * the C++ backend. `SV_UPDATE_GOLDEN=1 bun test` rewrites `golden/` — review the diff.
 */

const validator = new ContractValidator();
const GOLDEN_DIR = new URL("../../golden/", import.meta.url).pathname;
const goldenIds = readdirSync(`${fixturesDir}golden`).filter((d) => d.startsWith("GW-")).sort();

export function goldenRequest(id: string) {
  const ir = JSON.parse(readFileSync(`${fixturesDir}golden/${id}/ir.json`, "utf8"));
  const scenario = Bun.YAML.parse(readFileSync(`${fixturesDir}golden/${id}/scenario.yaml`, "utf8")) as Record<string, unknown>;
  return {
    project: { slug: id.toLowerCase(), appName: `${pascalCase(ir.name)}App`, language: "cpp", mqttTopicPrefix: `simvehicleapp/${id.toLowerCase()}`, traceLevel: "node" },
    workflows: [ir],
    options: { emitTests: true },
    scenarios: [{ workflowId: ir.workflowId, scenario }],
  };
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(dir, p));
    }
  };
  visit(dir);
  return out;
}

describe("golden C++ GW-A…GW-G (diff = 0)", () => {
  for (const id of goldenIds) {
    test(id, () => {
      const r = generate(goldenRequest(id));
      if (!r.ok) throw new Error(JSON.stringify(r));
      const dir = join(GOLDEN_DIR, id);
      if (process.env.SV_UPDATE_GOLDEN === "1") {
        rmSync(dir, { recursive: true, force: true });
        for (const f of r.fileSet.files) {
          mkdirSync(dirname(join(dir, f.path)), { recursive: true });
          writeFileSync(join(dir, f.path), f.content);
        }
      }
      expect(listFiles(dir)).toEqual(r.fileSet.files.map((f) => f.path));
      for (const f of r.fileSet.files) expect(f.content).toBe(readFileSync(join(dir, f.path), "utf8"));
    });
  }
});

describe("determinism and contract shapes", () => {
  test("the same request gives the same bytes; the file set, source maps and gen.json are consistent", () => {
    for (const id of goldenIds) {
      const a = generate(goldenRequest(id));
      const b = generate(structuredClone(goldenRequest(id)));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      if (!a.ok) throw new Error(id);
      const fs = a.fileSet;
      expect(validator.validate("generated-fileset", fs).errors).toEqual([]);
      for (const f of fs.files) {
        expect(fs.ownedRoots.some((r) => f.path.startsWith(r))).toBe(true);
        expect(new Bun.CryptoHasher("sha256").update(f.content).digest("hex")).toBe(f.sha256);
        expect(f.content).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no timestamps
      }
      const gen = JSON.parse(fs.files.find((f) => f.path.endsWith("simvehicleapp.gen.json"))!.content);
      expect(validator.validate("generation-manifest", gen).errors).toEqual([]);
      for (const e of gen.files) expect(fs.files.find((f) => f.path === e.path)?.sha256).toBe(e.sha256);
      // every IR trigger/node maps to lines of the workflow source
      const ir = goldenRequest(id).workflows[0]!;
      const map = fs.sourceMaps[0]!;
      const ids = map.ranges.map((r) => r.nodeId).sort();
      expect(ids).toEqual([...ir.triggers, ...ir.nodes].map((n: { id: string }) => n.id).sort());
      const lines = fs.files.find((f) => f.path === map.file)!.content.split("\n");
      for (const r of map.ranges) expect(lines[r.startLine - 1]).toContain(`// ${r.nodeId} · `);
    }
  });

  test("capabilities = backend.yaml, every opcode listed is implemented; bundles carry the runtime and the overlay", async () => {
    const handler = createBackendHandler();
    const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
    const caps = await (await handler(new Request("http://x/capabilities"), ctx)).json();
    expect(validator.validate("backend-capabilities", caps).errors).toEqual([]);
    expect([...caps.opcodes].sort()).toEqual([...OPCODES].sort());
    const rt = runtimeBundle();
    expect(rt.files.map((f) => f.path)).toContain("app/src/simvehicleapp-runtime/include/simvehicleapp/rt/Runtime.hpp");
    expect(rt.files.some((f) => f.path.includes("/tests/"))).toBe(false);
    const ov = overlayBundle();
    expect(ov.files.map((f) => f.path)).toEqual(["app/src/CMakeLists.txt", "app/src/user/UserHooks.cpp", "app/src/user/UserHooks.hpp", "app/tests/CMakeLists.txt"]);
    expect(ov.remove).toContain("app/src/SampleApp.cpp");
    for (const f of [...rt.files, ...ov.files]) expect(validator.validate("generated-fileset#/$defs/file", f).errors).toEqual([]);
  });
});

describe("AppManifest fragment (ADR-0023 §4, M06-T19)", () => {
  test("datapoints by path, write wins over read across workflows; topics by direction; sorted", () => {
    const wf = (id: string, signals: { path: string; access: string[] }[], topics: { topic: string; direction: string }[]) =>
      ({ workflowId: id, signals: signals.map((s, i) => ({ id: `s${i}`, dataType: "float", ...s })), topics: topics.map((t, i) => ({ id: `t${i}`, ...t })) }) as never;
    const f = manifestFragment([
      wf("a", [{ path: "Vehicle.Speed", access: ["subscribe"] }, { path: "Vehicle.Body.Horn.IsActive", access: ["read"] }], [{ topic: "app/out", direction: "write" }]),
      wf("b", [{ path: "Vehicle.Body.Horn.IsActive", access: ["write"] }], [{ topic: "app/in", direction: "read" }, { topic: "app/out", direction: "write" }]),
    ]);
    expect(f).toEqual({
      "vehicle-signal-interface": {
        required: [
          { path: "Vehicle.Body.Horn.IsActive", access: "write" },
          { path: "Vehicle.Speed", access: "read" },
        ],
        provided: [],
      },
      pubsub: { reads: ["app/in"], writes: ["app/out"] },
    });
  });
});

describe("rejections are diagnostics, never partial file sets", () => {
  const base = () => goldenRequest("GW-A");
  test("an opcode the backend does not implement ⇒ 422 OPCODE_UNSUPPORTED_BY_BACKEND on its block", () => {
    const req = base();
    req.workflows[0].nodes[0].opcode = "service.grpc_call";
    const r = generate(req);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.diagnostics[0]).toMatchObject({ code: "OPCODE_UNSUPPORTED_BY_BACKEND", nodeId: "n2", blockId: "b2", docs: "diagnostics#OPCODE_UNSUPPORTED_BY_BACKEND" });
    for (const d of r.diagnostics) expect(validator.validate("diagnostics", d).errors).toEqual([]);
  });
  test("IR 2.x ⇒ 422 IR_VERSION_UNSUPPORTED; a request that does not match the contract ⇒ 400", () => {
    const req = base();
    req.workflows[0].irVersion = "2.0.0";
    const r = generate(req);
    expect(!r.ok && r.status).toBe(422);
    expect(!r.ok && r.diagnostics[0]).toMatchObject({ code: "IR_VERSION_UNSUPPORTED", workflowId: "gw_a" });
    const bad = generate({ project: { slug: "x" }, workflows: [] });
    expect(!bad.ok && bad.status).toBe(400);
  });
});

describe("C++ text safety (ADR-0022 §7)", () => {
  /** Decodes a literal produced by cppString back to text (the escapes it uses only). */
  function decode(lit: string): string {
    let out = "";
    let inside = false;
    for (let i = 0; i < lit.length; i++) {
      const ch = lit[i]!;
      if (ch === '"') {
        inside = !inside; // adjacent literals ("…""…") after a \x escape
        continue;
      }
      if (!inside) throw new Error(`text outside a literal: ${lit}`);
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const n = lit[++i]!;
      const hex = (len: number) => {
        const v = Number.parseInt(lit.slice(i + 1, i + 1 + len), 16);
        i += len;
        return String.fromCodePoint(v);
      };
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "x") out += hex(2);
      else if (n === "u") out += hex(4);
      else if (n === "U") out += hex(8);
      else out += n;
    }
    return out;
  }

  test("cppString: only printable ASCII, every user string round-trips (fuzz)", () => {
    const samples = ['say "hi"\n', "back\\slash", "??=trigraph", "tab\t\r", "\u0000\u0001\u007f\u0085", "Ünïcode ✓ 🚗", '*/ /* "', "a\\"];
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 500; i++) {
      let s = "";
      const len = Math.floor(rnd() * 20);
      for (let j = 0; j < len; j++) {
        const pick = rnd();
        s += String.fromCodePoint(pick < 0.6 ? 32 + Math.floor(rnd() * 95) : pick < 0.8 ? Math.floor(rnd() * 32) : pick < 0.95 ? 0x80 + Math.floor(rnd() * 0x700) : 0x1f600 + Math.floor(rnd() * 50));
      }
      samples.push(s);
    }
    for (const s of samples) {
      const lit = cppString(s);
      expect(lit).toMatch(/^"[\x20-\x7e]*"$/);
      expect(lit).not.toMatch(/\?\?/);
      expect(decode(lit)).toBe(s);
    }
  });

  test("identifiers are [A-Za-z0-9_], never keywords or reserved names", () => {
    expect(sanitizeIdent("class")).toBe("class_");
    expect(sanitizeIdent("2fast")).toBe("x_2fast");
    expect(sanitizeIdent("__init__")).toBe("init");
    expect(sanitizeIdent("a-b c")).toBe("a_b_c");
    expect(snakeCase("IsSignaling")).toBe("is_signaling");
    expect(snakeCase("HVAC")).toBe("hvac");
    expect(snakeCase("Row1")).toBe("row1");
    expect(pascalCase("Stable Overspeed Warning")).toBe("StableOverspeedWarning");
    expect(pascalCase("2 doors")).toBe("Workflow2Doors");
    expect(pascalCase("new")).toBe("New");
    for (const s of ["", "😀", "rt", "c", "std", "main"]) expect(sanitizeIdent(s)).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    expect(rawString('x)sv"y')).toBe('R"sv1(x)sv"y)sv1"');
  });
});
