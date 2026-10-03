# Golden workflows

Corpus defined in `analysis/05` §5; format and parity rules in ADR-0042 and the `golden-and-parity-tests` skill.

| ID | Files present | Status |
|---|---|---|
| GW-A | `graph.json`, `scenario.yaml` | hand-written in M00-T06; validated against WorkflowGraph/Scenario v1-alpha |

Provisional choices until BlockSpecs land (M2/M3): block handle names (`next`, `stable`, `done`, `in`) follow the IR
handle names in `analysis/06` §2.2; `modelHash` is omitted until the catalog canonicalizer exists (ADR-0010).
`ir.json`, generated code and `expected.trace.json` are added by M4/M5/M6 — never hand-edited.
