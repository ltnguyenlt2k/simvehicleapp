import { describe, expect, test } from "bun:test";
import { leafRefs } from "./simulator.ts";

describe("data.eval references (ADR-0062 §2, M19-T02a)", () => {
  test("signals, outputs and variables of an expression, in order of first use, each once", () => {
    const expr = {
      op: "and",
      args: [
        { op: "<", args: [{ $ref: "n1.value" }, 20] },
        { $signal: "s2" },
        { op: ">", args: [{ $ref: "n1.value" }, { $state: "v1" }] },
      ],
    };
    expect(leafRefs(expr)).toEqual([{ $ref: "n1.value" }, { $signal: "s2" }, { $state: "v1" }]);
    expect(leafRefs(42)).toEqual([]);
    expect(leafRefs({ op: "not", args: [true] })).toEqual([]);
  });
});
