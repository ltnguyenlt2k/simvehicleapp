import { describe, expect, test } from "bun:test";
import { ContractValidator } from "@simvehicleapp/contracts";
import { compileDiagnostics, depsDiagnostics, testDiagnostics } from "./errors.ts";

const validator = new ContractValidator();
const map = {
  file: "app/src/generated/workflows/StableOverspeedWarning.cpp",
  ranges: [
    { startLine: 32, endLine: 40, nodeId: "n1", blockId: "b1", workflowId: "gw_a" },
    { startLine: 42, endLine: 49, nodeId: "n2", blockId: "b2", workflowId: "gw_a" },
  ],
};

describe("toolchain output ⇒ diagnostics on blocks (M07-T15)", () => {
  test("a GCC error in generated code points at the block (real g++ 11.4 output of a broken runtime call)", () => {
    // golden GW-A with `w.stableFor(` renamed `w.stableForX(` (M7 gate: runtime API mismatch)
    const log = [
      "FAILED: app/src/CMakeFiles/app.dir/generated/workflows/StableOverspeedWarning.cpp.o",
      "/workspace/projects/gw-a/app/src/generated/workflows/StableOverspeedWarning.cpp: In static member function ‘static void simvehicleapp::generated::StableOverspeedWarning::bind(simvehicleapp::rt::Runtime&)’:",
      "/workspace/projects/gw-a/app/src/generated/workflows/StableOverspeedWarning.cpp:43:7: error: ‘class simvehicleapp::rt::Workflow’ has no member named ‘stableForX’; did you mean ‘stableFor’?",
      "   43 |     w.stableForX(",
      "/workspace/projects/gw-a/app/src/simvehicleapp-runtime/src/Runtime.cpp:10:1: error: expected ';'",
    ];
    const d = compileDiagnostics(log, [map]);
    expect(d[0]).toMatchObject({ code: "CPP_COMPILE_ERROR", blockId: "b2", nodeId: "n2", workflowId: "gw_a", data: { file: map.file, line: 43, column: 7 } });
    expect(d[1]).toMatchObject({ code: "CPP_COMPILE_ERROR", data: { file: "/workspace/projects/gw-a/app/src/simvehicleapp-runtime/src/Runtime.cpp", line: 10 } });
    expect(d[1]!.blockId).toBeUndefined();
    for (const x of d) expect(validator.validate("diagnostics", x).errors).toEqual([]);
    expect(compileDiagnostics([log[2]!, log[2]!], [map])).toHaveLength(1); // the same error once
  });

  test("a failing generated gtest names its workflow; Conan errors keep their lines", () => {
    const log = [
      "[ RUN      ] StableOverspeedWarningTest.scenarioMeetsItsExpectations",
      "/workspace/projects/gw-a/app/tests/generated/StableOverspeedWarning_test.cpp:58: Failure",
      "Failed",
      'writes differ: expected [{"t":5000}] actual []',
      "[  FAILED  ] StableOverspeedWarningTest.scenarioMeetsItsExpectations (1 ms)",
      "[ RUN      ] WelcomeSequenceTest.scenarioMeetsItsExpectations",
      "[       OK ] WelcomeSequenceTest.scenarioMeetsItsExpectations (0 ms)",
    ];
    const d = testDiagnostics(log, (cls) => (cls === "StableOverspeedWarning" ? "gw_a" : undefined));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ code: "GENERATED_TEST_FAILED", workflowId: "gw_a", data: { test: "StableOverspeedWarningTest.scenarioMeetsItsExpectations" } });
    expect(d[0]!.message).toContain("writes differ");
    const deps = depsDiagnostics(["Installing...", "ERROR: Package 'fmt/11.1.1' not resolved: No remote defined"]);
    expect(deps[0]).toMatchObject({ code: "DEPS_INSTALL_FAILED", message: "ERROR: Package 'fmt/11.1.1' not resolved: No remote defined" });
    for (const x of [...d, ...deps]) expect(validator.validate("diagnostics", x).errors).toEqual([]);
  });
});
