# ADR-0076: closed RobotFlow graph, block and typed IR artifacts

Status: Accepted for implementation under user delegation, 2026-10-30.
Prerequisite M23 PASS; independent M25-T01 may proceed while M24 soak runs.
No compiler/runtime/live acceptance is implied by accepting these wire schemas.

ADR-0067 specifies concepts but not complete wire shapes. Freeze robotflow.v1,
block.v1 and rfir.v1 as closed Draft 2020-12 JSON schemas. Their deterministic
source is robotics/contracts/robotflow_contracts.py; checked-in JSON is consumed
across independent modules. Schema synchronization is tested. No module imports
another implementation or arbitrary lowering source.

Graph vars are named typed declarations with initial values (bool, int32,
float64, string), optional numeric units. Nodes carry id/block/v/props and optional
canvas x/y; edges use exact [node,port] endpoints. Compiler excludes UI from IR
and hashes. Closed objects reject arbitrary shell/code/metadata fields. S0 must
also reject duplicate JSON keys, NaN/Infinity, excessive nesting and size; JSON
Schema alone does not establish numeric finiteness or unique node identity.

Block ports explicitly declare input/next/body/branch/result/join roles and
required connections. Lowering is a closed registry handler identifier, never
executable source. Migrations are declarative rename/default data. Props have
typed descriptors; registry semantic validation must constrain combinations.

IR expressions are typed literal/signal/var/unary/binary/closed-call ASTs. No
eval or arbitrary call. Statements carry src.nodeId, including explicit noops for
structural trace nodes. Invoke/Hold/Cancel/Stop outcomes include succeeded,
failed,rejected,cancelled,timed_out; wait-until has success/timeout branches.
Loop count or forever are mutually exclusive; parallel children have all/any
semantics. Stage S5 must require a yielding path in every forever iteration.
The runtime version/profile/catalog/profile hash and deterministic IR hash are
explicit. Canonical hash rules and safety checks remain mandatory compiler work.

Keep existing diagnostic code->text entries compatible. Add RF1xxx–RF6xxx plus
localized details (stage/severity/message) without deleting RSS/PB entries.
Compiler diagnostic instances supply node/field/data, never substitute their own
unregistered public codes. Every RF code needs a deliberate compiler negative
test before M25 acceptance.

Rejected alternative: open-ended arbitrary JSON nodes/opcodes/props accepted into
runtime. Typed descriptors and closed AST make malformed or executable payloads
reviewable at each boundary. This is schema validation, not a Python sandbox;
runner execution/provenance/isolation gates remain M26 responsibilities.

Verification: valid graph/block/nested IR fixtures; unknown fields/opcodes,
missing source/results, invalid identities/versions/types; diagnostic metadata;
generated-schema equality. Full compiler/unit/conformance/live gates remain OPEN.

T02 refinement before any released compiled artifact: Hold has required
`timeoutMs` in addition to requested hold `ms`, so admission, timed hold and safe
release share an explicit finite overall budget. The earlier T01 shape omitted
that field; it is corrected while v0.1 is unimplemented/unreleased, with schema
fixtures regenerated. No deployed graph/IR migration or wire Protobus change.
