import { describe, expect, test } from "bun:test";
import { type BackendCapabilitiesV1, ContractValidator } from "@simvehicleapp/contracts";
import { BackendUnavailableError, checkBackend, httpCapabilities, type IrForCapabilities } from "./index.ts";

/** Stub backend (M6 backends do not exist yet): what a C++ backend declaring a subset would answer. */
function stub(over: Partial<BackendCapabilitiesV1> = {}): BackendCapabilitiesV1 {
  return {
    id: "cpp",
    name: "compiler-code-cpp",
    version: "0.1.0",
    language: "cpp",
    irVersions: ">=1.0.0 <2.0.0",
    contracts: ">=1.0.0-alpha.1 <2.0.0",
    opcodes: ["event.signal_changed", "event.app_start", "vehicle.write", "control.branch", "control.stable_for"],
    features: { concurrencyPolicies: ["restart", "ignore"], trace: true, sourceMaps: true },
    runtime: { name: "simvehicleapp-runtime-cpp", version: "0.1.0", vendorPath: "vendor/simvehicleapp-runtime" },
    toolchain: { id: "toolchain-cpp", template: "vehicle-app-cpp-template", templateSha: "0".repeat(40) },
    ...over,
  };
}

const ir = (over: Partial<IrForCapabilities> = {}): IrForCapabilities => ({
  irVersion: "1.0.0",
  workflowId: "wf",
  triggers: [{ opcode: "event.signal_changed", concurrency: { policy: "restart" }, src: { blockId: "b1" } }],
  nodes: [
    { opcode: "control.stable_for", src: { blockId: "b2" } },
    { opcode: "vehicle.write", src: { blockId: "b3" } },
  ],
  ...over,
});

describe("S7 backend capability (M04-T07)", () => {
  test("the stub is a valid BackendCapabilities document", () => {
    expect(new ContractValidator().validate("backend-capabilities", stub()).valid).toBe(true);
  });

  test("everything supported ⇒ no diagnostics", async () => {
    expect(await checkBackend(ir(), "cpp", async () => stub())).toEqual([]);
  });

  test("IR version outside the backend range ⇒ IR_VERSION_UNSUPPORTED (and nothing else)", async () => {
    const d = await checkBackend(ir({ irVersion: "2.0.0" }), "cpp", async () => stub());
    expect(d).toEqual([expect.objectContaining({ code: "IR_VERSION_UNSUPPORTED", stage: "backend", data: { backend: "cpp", irVersion: "2.0.0", supported: ">=1.0.0 <2.0.0" } })]);
  });

  test("unsupported opcode / concurrency policy ⇒ OPCODE_UNSUPPORTED_BY_BACKEND once per block", async () => {
    const d = await checkBackend(
      ir({
        triggers: [{ opcode: "event.timer", concurrency: { policy: "ignore" }, src: { blockId: "t" } }, { opcode: "event.signal_changed", concurrency: { policy: "queue" }, src: { blockId: "b1" } }],
        nodes: [
          { opcode: "comm.mqtt_publish", src: { blockId: "hmi" } },
          { opcode: "comm.mqtt_publish", src: { blockId: "hmi", inserted: true } },
          { opcode: "vehicle.write", src: { blockId: "b3" } },
        ],
      }),
      "cpp",
      async () => stub(),
    );
    expect(d.map((x) => [x.blockId, x.data])).toEqual([
      ["t", { backend: "cpp", opcode: "event.timer" }],
      ["b1", { backend: "cpp", opcode: "event.signal_changed", reason: "concurrency", policy: "queue" }],
      ["hmi", { backend: "cpp", opcode: "comm.mqtt_publish" }],
    ]);
    expect(d.every((x) => x.code === "OPCODE_UNSUPPORTED_BY_BACKEND" && x.severity === "error")).toBe(true);
  });

  test("unknown or unreachable backend ⇒ BACKEND_UNAVAILABLE", async () => {
    expect((await checkBackend(ir(), "cobol", async () => null))[0]).toMatchObject({ code: "BACKEND_UNAVAILABLE", data: { backend: "cobol", reason: "unknown_backend" } });
    const down = await checkBackend(ir(), "cpp", async () => {
      throw new BackendUnavailableError("cpp unreachable: ECONNREFUSED");
    });
    expect(down[0]).toMatchObject({ code: "BACKEND_UNAVAILABLE", data: { backend: "cpp", error: "cpp unreachable: ECONNREFUSED" } });
  });
});

describe("httpCapabilities: cached GET /capabilities", () => {
  test("caches per backend for the TTL, never caches failures, unknown ids are null", async () => {
    let calls = 0;
    let t = 0;
    let fail = false;
    const lookup = httpCapabilities({
      backends: { cpp: "http://cpp:4100/" },
      ttlMs: 1000,
      now: () => t,
      fetch: async (url) => {
        calls++;
        expect(url).toBe("http://cpp:4100/capabilities");
        return fail ? new Response("", { status: 502 }) : Response.json(stub());
      },
    });
    expect((await lookup("cpp"))?.id).toBe("cpp");
    t = 999;
    await lookup("cpp");
    expect(calls).toBe(1);
    t = 1000;
    fail = true;
    await expect(lookup("cpp")).rejects.toBeInstanceOf(BackendUnavailableError);
    fail = false;
    expect((await lookup("cpp"))?.id).toBe("cpp");
    expect(calls).toBe(3);
    expect(await lookup("toString")).toBeNull();
    const net = httpCapabilities({ backends: { cpp: "http://cpp" }, fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    await expect(net("cpp")).rejects.toThrow("cpp unreachable: ECONNREFUSED");
  });
});
