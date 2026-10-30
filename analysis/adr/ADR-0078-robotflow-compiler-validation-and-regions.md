# ADR-0078: deterministic compiler policy, regions and safety checks

Status: Accepted for M25-T04 implementation under user delegation, 2026-10-31.
T01/T02 scoped CI and T03 local tests PASS; compiler acceptance remains OPEN.

The compiler is a pure function of graph, validated RSS catalog, approved compiler
policy, block registry and canonical unit data. It returns diagnostics and IR/file
data, never writes projects or calls ROS/LLMs. Validate input size/depth/duplicate
JSON keys/nonfinite values before schema. Diagnostics retain registered code,
stage, severity, node/field/data and localized messages. Run stages in order and
stop unsafe later-stage evaluation after errors; warnings do not erase errors.

A closed robotflow-profile.v1 is a compiler policy, distinct from mapping.v1.
It fixes catalog/backend/Arm authorization, commissioned scene/map frame and
bounded node/move/wait/command/loop/patrol/run budgets. Graph input cannot grant
itself Arm permission. Profiles default to remote Arm disabled. Deploy/start
mapping/source/map-generation bindings remain separate required live metadata
work; a profile ID alone cannot prove them.
Coordinate bounds constrain requests, not certify collision-free/reachable space.
Brain's actual current-map planning/admission remains mandatory; no coordinates
are derived from odometry or ground truth by this compiler policy.

Each output has at most one edge; fan-in requires explicit Join. Graph cycles
are forbidden; loops use isolated body and done regions. Parallel children are
isolated and awaited. Reject region overlap/escape and concurrent writes to the
same variable. Commands/If/WaitUntil lower result continuations into branches;
there is no implicit success continuation after an error. Patrol expands bounded
sequential GoTo continuations and aborts remaining points on any non-success.
Every forever path must yield. Source identity persists even when a shared tail
is duplicated into mutually exclusive IR branches.

Validate RSS kinds, expression types/dimensions, declared variable assignment and
timeout/result completeness. Prove velocity bounds with literals/catalog ranges/
interval arithmetic or explicit clamp; unknown unbounded speed is rejected,
with runtime range checks still mandatory. Validate per-operation budgets and
single body owner in explicit Parallel. Priority Stop is outside the body lock;
missing Stop is a warning. Independent behaviors require runtime arbitration.

IR binds catalogHash, profileHash, unitsHash, runtime version and canonical irHash;
UI coordinates never enter IR/hash. This adds unitsHash before any released
compiled artifact so changed unit semantics cannot hide behind an unchanged IR.
Public RF codes stay stable; add distinct patrol/concurrent-write diagnostics.
Lint returns diagnostics, build additionally produces validated canonical IR.

Verification before acceptance: deliberate fixture for every RF code; graph/UI
determinism; malformed/race-prone/unsafe regions; valid structured lowering;
200-node lint below 300 ms on recorded conditions; all prior contracts/parser
tests. Runtime/source codegen/conformance/live workflow/video remain later gates.
