# Golden workflows

Corpus defined in `analysis/05` §5; format and parity rules in ADR-0042 and the `golden-and-parity-tests` skill.
Conformance cases for single semantics rules live next door in `../conformance/` (ADR-0012 §10).

| ID | Workflow | Files present | Status |
|---|---|---|---|
| GW-A | Stable Overspeed Warning | `graph.json`, `scenario.yaml` | M00-T06; moved to BlockSpec handle ids + normalized refs in M03-T12 |
| GW-B | Low Battery HMI Warning | `graph.json`, `scenario.yaml` | M03-T13 |
| GW-C | Auto Wipers | `graph.json`, `scenario.yaml` | M03-T13 — range lookup as an SVX ternary (`sv_lookup` matches equal values) |
| GW-D | Auto Door Lock | `graph.json`, `scenario.yaml` | M03-T13 — 4 × `sv_set_actuator` (`sv_set_many` is P1, not in M3) |
| GW-E | Periodic Telemetry | `graph.json`, `scenario.yaml` | M03-T13 — publishes checked through trace matchers |
| GW-F | Welcome Sequence | `graph.json`, `scenario.yaml` | M03-T13 |
| GW-G | Window Close on Rain | `graph.json`, `scenario.yaml` | M03-T13 — 4 × `sv_set_actuator` (block VSS paths are static) |

Deviations of GW-C, GW-D, GW-G from `analysis/05` §5 accepted by the PO on 2026-10-04 (`sv_set_many` and range lookup wait for a real need).

Conventions (since M2/M3): edge handles are BlockSpec handle ids (`source`, `target`, `then`, `stable`, `loop-start-source` …,
ADR-0011 Notes); references use Sim-normalized block names (`<speedchanged.value>`, ADR-0013 Notes); expression props
are SVX source strings, other props are literals. Expectations are hand-derived; `packages/ts/src/conformance.test.ts`
checks every graph/scenario pair for schema validity, reference and VSS consistency.

Still to come: `sim-state.json` (studio export of each workflow built on the canvas, input of the M4 graph-adapter golden
test), `ir.json` (M4), generated code (M6) and `expected.trace.json` (M5) — the last three are generated, never hand-edited.
