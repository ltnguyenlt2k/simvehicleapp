import { describe, expect, test } from "bun:test";
import { compareTraces, drifts, STARTUP_ALLOWANCE_MS, TOLERANCE_MS } from "./parity-p3.ts";

/**
 * Drift of a real run vs the frozen trace (ADR-0042 P3): trigger-caused events from their trigger, events a
 * later scenario input caused (a wait it resumes) from when the gateway played that input (nightly GW-G,
 * 2026-10-07: a slow trigger reaction made the 1500 ms events look 66 ms early).
 */
describe("parity P3 drifts", () => {
  const ev = (ts: number, e: string, node: string) => ({ ts, ev: e, node });
  // GW-G shape: trigger at 1000, the wait resumes on the inputs at 1500.
  const expected = [ev(1000, "trigger", "n1"), ev(1000, "enter", "n6"), ev(1500, "exit", "n6"), ev(1500, "value", "n7")];
  const startedAt = 1_000_000;
  // The app reacted to the 1000 ms input 66 ms late; the 1500 ms inputs were played on time and handled at +2 ms.
  const actual = [ev(startedAt + 1066, "trigger", "n1"), ev(startedAt + 1066, "enter", "n6"), ev(startedAt + 1502, "exit", "n6"), ev(startedAt + 1502, "value", "n7")];

  test("without the play time, events of a later input look early by the trigger's delay", () => {
    expect(drifts(expected, actual).slice(2)).toEqual([-64, -64]);
  });

  test("from the input's play time they are on time; trigger-caused events keep the trigger reference", () => {
    expect(drifts(expected, actual, { startedAt, inputs: [1000, 1500, 1500] })).toEqual([0, 0, 2, 2]);
    // No later input: the old reference (reaction since the trigger).
    const late = [ev(startedAt + 1066, "trigger", "n1"), ev(startedAt + 1066, "enter", "n6"), ev(startedAt + 1580, "exit", "n6"), ev(startedAt + 1580, "value", "n7")];
    expect(drifts(expected, late, { startedAt, inputs: [1000] }).slice(2)).toEqual([14, 14]);
  });
});

describe("startup allowance (first trigger of a run only)", () => {
  const ev = (ts: number, e: string, node: string) => ({ ts, ev: e, node, wf: "w" });
  // GW-A shape: triggers at 1000 and 2000; only the app's very first notification may wait for its subscription.
  const expected = [ev(1000, "trigger", "n1"), ev(1000, "enter", "n2"), ev(2000, "trigger", "n1"), ev(2000, "enter", "n2"), ev(3000, "trigger", "n1")];
  const run = (first: number, second: number) => [ev(first, "trigger", "n1"), ev(first, "enter", "n2"), ev(second, "trigger", "n1"), ev(second, "enter", "n2"), ev(3000, "trigger", "n1")];

  test("a late first trigger within the allowance passes (nightly 38538593326: +68 ms)", () => {
    expect(TOLERANCE_MS).toBe(30);
    expect(compareTraces(expected, run(1068, 2000))).toEqual([]);
  });

  test("beyond the allowance, early, or on a later trigger it fails", () => {
    expect(compareTraces(expected, run(1000 + STARTUP_ALLOWANCE_MS + 10, 2000))[0]).toContain(`> ${STARTUP_ALLOWANCE_MS}`);
    expect(compareTraces(expected, run(960, 2000))[0]).toContain("> 30");
    expect(compareTraces(expected, run(1000, 2040))[0]).toContain("#2 trigger");
  });
});
