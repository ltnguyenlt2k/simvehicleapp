# M25 progress

M23 prerequisite PASS. ADR-0069 and M25 explicitly allow the compiler/mock branch
independently of the M24 live soak. No M24 acceptance is inferred from this work.
M24 scoped technical gate PASS, including 350f2ca8 fresh-zero fixture CI.

T01 local PASS: closed Draft 2020-12 robotflow.v1, block.v1 and recursive typed
rfir.v1; graph identities/vars/ports, declarative registry metadata and migrations,
all command result branches, explicit source IDs, profile/catalog/runtime hashes.
Nine contract test groups PASS /0.142 s in pinned Python 3.12, network-none,
read-only nonroot container. Includes malformed identities/types, executable/
unknown payload fields/opcodes, incomplete outcomes, numeric type confusion/
uint8 overflow and deterministic generator/schema equality. Initial red test
failed because schemas were absent, retained in ignored runtime/m24; later logs
under runtime/m25. Localized RF1001–RF6006 catalog added without deleting RSS/PB
entries; actual compiler negative coverage for every RF code remains T04.

ADR-0076 records exact wire decisions and limits of schema validation. New tool
image owns its context; only contract artifacts shared, no ROS or vehicle import.
Dependencies reuse existing pinned robotics versions. CI contract/OSV steps added;
T01 Robotics CI 41094829674 SUCCESS at 964f636b. Expression parser T03, compiler/emitter,
runtime, conformance and live RW-A..D remain OPEN. No workflow/UI/video delivered.

Final Compose tool-image test covers every statement/trigger wire family; RSS
contract regression 20 PASS /0.511 s, dependency/pin guard and full-profile Compose
config PASS. JSON schemas do not implement semantic reachability/units/safety;
those deliberate negative cases remain required before compiler acceptance.

T02 local PASS: 24 single-source declarative block files (five triggers, nine
robot operations, seven flow blocks, Log/Join/End), localized titles/semantics,
closed lowerings, required typed result ports and finite timeouts. Registry
snapshots/hash are canonical and mutation-independent. Loader rejects duplicate
keys, aliases, nonfinite/overflow values, enum duplicates, inverted bounds,
filename/id/category/lowering mismatches, unknown properties and invalid defaults.
Every robot operation has all five result branches; Stop is explicitly priority.
SEMANTICS.md fixes region/cancellation/cleanup/freshness requirements for T04/T06.
Initial red missing-registry import retained; final **14 PASS /0.870 s**, including
9 contract +5 registry groups, precheck/config PASS. Hold IR gained its required
overall timeout before any compiled artifact existed (ADR-0076 amendment), fixtures
updated and schema generator synchronized. T02 candidate CI remains pending.

T03 local PASS (2026-10-31): handwritten bounded lexer/Pratt parser, closed AST,
typed RSS/var/function operations, dimension vectors and SI normalization.
163 explicit expression cases (64 arithmetic, 54 precedence/units/functions/
integer boundaries, 45 deliberate errors), every valid constant AST validated
against rfir.v1. Combined 19 groups PASS /1.055 s. Signed Celsius exposed binary
offset cancellation; original failing log retained, decimal scale/offset
normalization precision 50 fixes it without epsilon equality. No eval or arbitrary
calls; syntax/token/depth/range/quality-kind boundaries enforced. RSS consumes the
new data-only units.v1 contract, with its former units.yaml retained as a checked
compatibility snapshot. 22 RSS regression tests PASS /0.481 s, including signed
affine round-trip, bool/nonfinite/overflow rejection and exact frozen catalog byte
comparison (f382fce1... unchanged). Dependency/pin/unit-snapshot guard PASS.
ADR-0077 records decisions. T03 candidate CI pending; T04 compiler next.

Required integration follow-up before T08/M26: protocol v1.3 currently advertises
profile ID but not the actual mapping/profile hash. Immutable deployment cannot
claim target hash verification by comparing only an ID. Add a versioned explicit
metadata interface with negative mismatch tests before live artifact acceptance.
This is not a current M24 transport failure, and must not be silently skipped.
RW-A live additionally needs qualified marker mapping; currently unavailable
marker/leg fields remain NONE rather than fabricated values.

T03 CI qualified: 604f346f Robotics 41099279722 + general 41099279588 SUCCESS.
T02 881889f6 Robotics 41096735300 + general 41096735367 SUCCESS.

T04 local PASS: pure S0–S6 compiler, closed approved SIM policy schema, original
catalog hash validation, source/port/type/unit/region/safety diagnostics and typed
structured IR. Deliberate fixtures for all 31 RF codes; all 24 block lowerings
have valid fixtures. UI coordinates and node/edge order do not affect IR/hash.
Canonical profile/units identities bind IR even without literal unit use. Native
IR expansion bounded before large JSON allocation; forever-loop yield proof uses
reverse DAG order (no Python recursion), and an immediately true WaitUntil is not
a guaranteed delay. Shared variable writers/body owner conflicts are rejected.

Final compiler suite **30 groups PASS /8.869 s**, including the 163 expression
cases. Warm cached 200-node lint **44.816 ms** on 2-CPU/256-MiB offline read-only
container (<300 ms). Foundation regression RSS22 and Protobus112 /30.413 s PASS;
precheck PASS. M25-compiler-checkpoint.json pins image/source and scope. Candidate
CI still pending; source emission/runtime/conformance/live apps remain OPEN.
ADR-0078 adds compiler-policy/unitsHash/region budget rules before any released
compiled artifact; tests and schema source synchronized.

Live integration work remains mandatory before T08/M26: (1) actual mapping hash
and source/map context metadata, with Stop receipt identity; (2) normal explicit
Cancel should preserve MANUAL after confirmed recovery when authority remains
valid, whereas timeout/Stop/loss must retain fail-safe revocation; current adapter
uses Stop for every cancellation, so do not claim RW-D handover yet; (3) marker
mapping qualification; (4) actual paused/reset-clock freshness probe, distinguishing
clock-message receipt from clock advance. These are upcoming integration tasks,
not accepted from parser/compiler unit tests. Final video remains OPEN.
