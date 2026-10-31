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

T05 local PASS (2026-10-31): deterministic native async Python emitter, fixed
10-file application set, immutable normalized source/IR/catalog/profile/units/
registry identities and exact UTF-8 file/source/artifact hashes (ADR-0079).
RW-A..D reviewed golden IR/source files compile twice to identical bytes, including
UI/node/edge order invariance. Generated Python uses native async/if/for/while;
module import does not run the application. Hostile log strings remain data.
Runtime wheel hash is omitted until an actual T06 package exists; live deployment
must reject an absent pin. This is codegen evidence, not runtime execution.

The first complex template run exposed exponential recursive JSON Schema checking:
wrong-opcode alternatives recursively rechecked result branches. Failure log kept
in runtime/m25/codegen-failed-recursive-schema-performance.log. Discriminated
opcode validation now visits only the selected closed variant; loop count/forever
remain exclusive. Negative nested/open-field fixtures plus bounded four-template
regression cover the fix. Final 38 groups PASS /14.726 s in Compose; precheck and
diff whitespace checks PASS. Localized property/enum labels added to single-source
block descriptors for the upcoming UI. T05 candidate CI pending. T06 next;
conformance/live/UI/video remain OPEN.
T04 e6920f58 CI qualified: Robotics41105342036 and general41105342105 SUCCESS.

T05 CI qualified at 2fee1031: Robotics41110002948/general41110003083 SUCCESS.
T06 IN_PROGRESS: independent ROS/compiler-free runtime foundations now verify
the closed artifact set before import, return immutable checked bytes, reject
missing/wrong runtime pins, altered files/semantic identities, symlinks and extra
module paths. Strict JSON rejects duplicate/nonfinite/overflow numbers. Typed
AST execution has 118 explicit wire fixtures and dynamic unit/unknown/overflow
cases. 14 groups PASS /2.735 s; precheck/diff checks PASS. Initial registry hash
interpretation mismatch retained and corrected against its public data contract.
ADR-0080 records identity versus trust and non-coercible unknown semantics.
Unit runtime digest is deliberately synthetic; no actual wheel or application
launch is claimed. BusClient/engine/Hold/lease/trace/event/shutdown/wheel remain
required for T06. T07–T09, GUI and final continuous video remain OPEN.

T06 prerequisite extension local PASS: Protobus protocol candidate 1.4 adds
read-only InspectExecution with catalog/epoch/execution correlation, separate
logical and physical terminal states, current provider session and STOP receipt
identity (ADR-0081). Quarantine cleared by ResetStop does not fabricate an old
physical result. Late matching release is idempotent; conflicting terminal fails.
Actual gRPC tests cover pending/confirmed/late feedback, wrong identity and
post-STOP inspection without authority. RSS22 + broker118 groups /31.113 s PASS;
after CLI addition, CLI6 /UNRECORDED s and protocol5 /0.001 s PASS (actual duration in
runtime logs authoritative). precheck/diff PASS. Production live remains the
previous qualified 1.3 image; no unqualified recreation or motion performed.
Mandatory target mapping/source/context metadata, normal Dog Cancel and freshness
qualification remain unresolved before live runtime acceptance. T06 still OPEN;
no full runtime, conformance, GUI or video completion claim.

T06 internal execution checkpoint: native generated RW-B visits all six
waypoints and Disarms; injected second-waypoint timeout skips remaining points,
runs Stop cleanup and retains TIMED_OUT. Unknown setup condition cannot select
a reset/Arm branch. Structured Parallel-any waits loser cleanup, propagates
cleanup failure and survives repeated parent cancellation without detached tasks.
Behavior scheduling implements explicit launch, bounded drop/queue/restart,
condition debounce with fresh-false rearm, on-change value semantics, periodic
skip of missed ticks and named event replay suppression. Restart awaits cleanup;
lease loss/deadline starts independent Stop before draining owned tasks.

Final runtime foundation/core/engine suite **30 groups PASS /4.052 s**, including
118 expression fixtures; precheck/diff PASS. These are explicit internal fake-bus
unit tests and native source execution, not actual Protobus/ROS conformance.
Remaining T06 BusClient/Hold/lease/transport/real-wheel/entrypoint/shutdown and
T07–T09 remain OPEN. Event identity storage is bounded at1024; exhaustion rejects
further events until a new explicit run, rather than evicting replay history.

T06 target-identity prerequisite local PASS (protocol candidate1.5, ADR-0082):
Descriptor carries actual provider kind/mapping/source-lock hashes plus observed
ROS Brain/scene/string-map-generation and effective Arm permission. Mock cannot
claim Brain/map identity. Get/Subscribe identify the current provider session.
Context changes fail safe and replace the session; actual socket test proves an
old moving mock lease cannot replay after a profile change. Four old model tests
mutated their profile during a live session; failure retained. They now explicitly
reconnect and recover through RPC before their unchanged motion/timing assertions.
Actual producer map generation is a string (brain.py824), preserved without a
numeric substitute. Source identity covers own code, dependency locks, interface
manifest and wire/data contract bytes; no runtime source label is trusted.

Final RSS22 + Protobus123 PASS /32.847 s; appended ABI baseline5 PASS. Humble
image/import/RMW PASS; backend8 /0.694 s and isolated bridge4 /2.253 s PASS.
Actual DDS read-only observer received9 Brain frames with advancing source stamps,
matching stable courtyard map/scene context,0 command publishers/requests/leases.
ROS parameter-events publisher is reported separately; initial overbroad zero-all-
publishers assertion retained. M25-target-context-checkpoint.json pins candidate
images/source and unchanged production1.3 images. This is metadata evidence only;
new candidate control, freshness/clock and normal Cancel remain unqualified.
Runtime/GUI/video completion remains OPEN.
Prior checkpoint CI: 34cc8dd8 Robotics41110639049 SUCCESS; 2cc096c1
Robotics41111172694 SUCCESS; their general jobs were superseded/cancelled, not
claimed PASS. 200bbfdf Robotics41112001341 SUCCESS; general41112001407 pending.

T06 implementation audit: SetTarget receipt lacks actual first-admission and
correlated safe-release feedback. Do not implement Hold success from Reply.ok,
elapsed duration or unrelated velocity zero. ADR-0083 specifies bounded Hold
execution identity/sequence feedback, duration after actual admission, resource
quarantine through physical release, immutable timeout and independent safety.
Next action is this transport/backend prerequisite, then complete BusClient/Hold/
wheel. Normal Cancel cause/recovery and ROS freshness gates remain mandatory.
This finding is not accepted from the already-passing metadata tests; full
runtime/GUI/video remain unfinished.

T06 Hold prerequisite component: bounded HoldLedger8 groups PASS /0.001 s;
strict owner/session/sequence, immutable logical versus physical terminal, retry
cleanup deadline and recovery-without-fabricated-proof cases. The module is NOT
yet wired into broker/provider. An initial fixture argument collision is retained
and corrected. No transport/Hold/live success claim; wire/backend integration is
the next action, then BusClient/wheel/conformance and final GUI/video.

T06 Hold transport checkpoint candidate1.6: broker/provider ledger integration,
operation receipts/accepted sequences, correlated safe release quarantine and
backend application callbacks. Fresh owner required after completed Hold. Added
actual socket identity/retry/late-ACK tests and blocked mock target-admission ACK
with independent confirmed Stop. RSS22 + broker134 PASS /33.331 s. Initial run
failed three old TTL safe-dispatch checks because redundant Stop coalesced their
safe message; fixed release-timeout escalation scope, preserving original timing
assertions. Failure logs retained. Fixtures explicitly acknowledge release instead
of treating its receipt as body availability. ROS admission/release implementation
requires dedicated actual qualification next; no production replacement performed.
BusClient/Hold/wheel/conformance/live templates/GUI/video remain OPEN.

T06 actual Hold prerequisite checkpoint: two consecutive actual broker1.6 ->
Humble provider -> Brain -> MuJoCo passes, each explicitly ResetStop/Arm, wait for
first target admission, Hold, correlated safe release, BOW then Disarm. Latest
source measured odom displacements0.187470597/0.214411649 m; release confirmation
0.045191606/0.045743275 s. These are safe-output/body-release timings, not physical
coasting distances or full workflow acceptance. M25-hold-live-checkpoint.json pins
qualified images, source, execution identities and actual phase evidence.

First fixture attempt correctly failed closed on audit directory permissions;
fixed isolated tmpfs ownership. A repeated actual pass exposed Disarm versus
authority-renew race: a renew attempted while Brain revoked the grant could tear
down the safety lane before terminal Disarm. Explicit revocation now suspends
renewal, clears the local grant on accepted Disarm and ignores only an already-
revoked in-flight renew; it never restores/reclaims a grant. Dedicated delayed
Disarm unit test plus two actual passes qualify the fix. Original failures kept.
ROS map/source changes cannot confirm old target release. Humble backend12 tests
PASS /0.998 s; final RSS22/broker138 PASS /34.232 s; precheck/diff PASS. Isolated
fixture torn down without deleting volumes; production qualified1.3 unchanged.
Next: normal Cancel/freshness prerequisites and rfrt BusClient/Hold/wheel/entrypoint,
then actual conformance/live generated flows, GUI deployment and full video.
No hardware or final M25/M26/M27 acceptance claimed.
