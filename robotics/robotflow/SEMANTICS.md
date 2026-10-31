# Block registry v0.1 semantics

The 24 `blocks/*.block.yaml` records are the sole palette/compiler block data.
They are owned declarative YAML (JSON syntax subset), not executable extensions.
`registry.py` validates schemas/defaults/closed lowering identifiers and exposes
canonical immutable snapshots plus a registry hash. No duplicate keys, aliases,
nonfinite values, unknown fields/lowerings or unsafe file escapes enter it.

## Control and regions

Triggers have no input; statements have `in`. Each output has at most one edge.
`join` allows multiple mutually exclusive inputs; it is not a parallel barrier.
If chooses then/else; Loop has an isolated body and done continuation; Parallel
has two isolated child regions and done. End finishes the current region, not
the whole app, and cannot skip cleanup. Unstructured graph back-edges are invalid.
Log can terminate a path without another node. Other required outputs must connect.

All robot blocks have a finite `timeoutMs` and all five required result outputs:
succeeded, failed, rejected, cancelled, timed_out. The chosen result handler runs
once; there is no implicit next/success continuation after an error. A failed
region aborts remaining loop iterations/waypoints and propagates to its parent.
Cleanup success cannot erase the original operational failure from run status.
Structural cancellation of a losing Parallel-any child is expected cleanup,
distinct from an unexpected command failure. all awaits both children; any cancels
and awaits losing-child cleanup before done. Never detach a motion coroutine.

Vars are declared and initialized with types/units. Assignments are atomic in the
runtime owner loop; concurrent roots/parallel regions must not write the same
variable (compiler flow check). Reads/expressions evaluate a consistent snapshot.
All statement/region/trigger evaluations retain node identity in trace.

## Robot operations

Arm/Disarm/ResetStop/GoTo/Perform use their declared high-level bus commands.
Success requires current correlated physical terminal/release. A Brain ACK alone
does not satisfy success; a later physics rejection is failed. Missing/mismatched
physical completion cannot release resource ownership. Stop has independent
priority and needs no body lock; receipt/dispatched/confirmed are separate.
Cancel operates only on tracked execution identities, awaiting physical release.

Move is a complete typed velocity Hold: refresh at catalog cadence, bounded
duration and overall timeout including cleanup, safeValue/release on every exit.
Unknown release triggers Stop. GoTo uses map coordinates with commissioned scene/
map generation; no odom/ground-truth substitution. Patrol expands a bounded list
and repetition count into sequential GoTo; each point uses the declared timeout,
and any non-success skips all remaining points before its one result handler.
No body operation silently Arms, reclaims a lost lease or replays after reconnect.

The frontend Move always emits bounded Hold. The reserved low-level set_target
IR primitive is a one-shot admission followed by immediate safe release; it is
not an unbounded background writer and is not offered as a frontend block.

## Time and observation

Safety deadlines, waits, debounce and periodic triggers use monotonic time.
Condition triggers require fresh true throughout forMs and reset on stale/NONE;
they re-arm only after fresh false. Change triggers observe value changes, not
capture timestamp refresh. Every skips missed ticks instead of burst replay.
WaitUntil cannot succeed from unavailable data and always has a finite timeout.
Get refreshes current capture/quality; Subscribe remains on-change. Never compare
ROS capture timestamps directly to host monotonic time or invent missing zeros.

These are required compiler/runtime rules, not implementation acceptance. T03–T08
must prove parser/type/flow/safety, deterministic codegen and actual conformance.
Live RobotFlow execution and final video remain later gates.
