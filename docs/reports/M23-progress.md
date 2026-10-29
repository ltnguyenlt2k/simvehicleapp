# M23 execution evidence — in progress

## Prerequisite

M22 scoped gate PASS at 0abd1585, Robotics CI 40874429999. T01 compiled protocol,
mapping schema, public diagnostics and version compatibility tests are implemented.
Protocol Safety refinement is ADR-0070, independently tested with actual TCP peers
and backpressured ordinary writes. No physical stop is claimed from that fixture.

## T02 S-R4 — PASS, 2026-10-29

Full 1800.010964588 s, 9,090,950 samples, four subscribers each complete, actual
5050.497 samples/s, entire-run p95 0.74 ms and broker RSS comparison -164 KiB.
Container exited 0. Evidence: M23-S-R4-evidence.json, raw logs and container inspect
in robotics/runtime/m23. This qualifies minimal Python transport feasibility;
production safety and integrated performance require their own evidence.

## T03 data broker — local PASS, 2026-10-29

Implemented load-time catalog schema/hash checks; typed atomic sample validation;
actual Get/Subscribe snapshot and coalesced values; non-coalesced quality changes
that bypass value throttling; missing value NONE; stale timers based on monotonic
receipt/capture progress; source sequence/epoch/clock checks; provider heartbeat
timeout; local SIM clock/catalog/profile/version handshake; actual independent
Safety TCP peer enforcement; bounded subscriber/quality queues.

Command: docker build -t sr-protobus:dev robotics/protobus, then docker run --rm
--network none --cpus 2 --memory 256m sr-protobus:dev. Final local run: **24 tests
PASS / 1.487 s**, including 18 data/bounds cases and the existing six protocol/wire
cases. Tests use actual grpc.aio loopback sockets for the data plane; they are not
ROS live tests or HTTP mocks. Actual ROS integration remains M24.

Whole-frame rejection prevents partial store updates. A repeated frozen capture
timestamp cannot renew sensor freshness merely by increasing its sequence number.
Changing source epoch requires provider reattachment. Subscriber quality overflow
fails explicitly instead of silently dropping safety transitions.

## Next steps and open gates

T04 lease, target TTL and resource ownership; T05 command lifecycle/STOP/audit;
T06 mock provider/scenarios; T07 CLI; T08 Compose/fault CI; T09 full milestone gate.
Unimplemented write RPCs remain explicitly unimplemented until the corresponding
control code is verified. The data broker is not advertised as a complete runtime.
M24/M25 must not start before the complete M23 safety gate passes.

T04 must distinguish ownership of concurrent behaviors inside one app, not merely
one external lease. Each Hold needs an owner identity and an explicit safe release.
Absolute same-host monotonic deadlines, fencing and sequences must survive delayed
cross-connection delivery; stale safe-value dispatches must not override a newer
lease/target. Lease release/expiry must purge queued authority and apply safeValue
once. Later STOP must revoke authority globally and cannot depend on audit I/O.

## T04 lease/targets — local PASS, 2026-10-29

Protocol v1.2 (ADR-0071) adds Hold owner and explicit safe release, plus provider
LEASE_UPDATE/LEASE_REVOKED notices. Implemented one bounded lease with random
token/broker epoch/fence, original-duration renewal, global target replay sequence,
exact typed atomic fields, declared safeValue checks, target/lease minimum absolute
deadline, distinct behavior owner rejection, safe release and monotonic expiry.
Provider/data/control/safety lane loss revokes old authority. Catalog supports at
most eight setpoints; a bounded coalescing safety queue preserves STOP.

Actual capped-container run: **38 tests PASS / 3.186 s**, comprising the existing
24 plus 14 lease/target/config cases. RPCs and actual Control/Safety stream receipt
exercise expiry, renew, release, wrong epoch/token, competing owner, replay,
invalid/partial/nonfinite fields, fresh-target extension, no active target lease
expiry and lost lanes. TTL safe dispatch is asserted <=300 ms +50 ms with exactly
one safeValue message. Raw log: robotics/runtime/m23/lease-final-tests.log.
Dependency scan of all ten pinned Protobus requirements: No issues found.

This is broker-to-provider-wire evidence, not actual physics/ROS stop evidence.
T06 must enforce deadlines/fences on provider receipt under reordered connection
delivery. T08 adds actual independent-process kill/restart faults. T05 begins only
after the local T04 checks above. M23 overall acceptance is still OPEN.

## T05 lifecycle/STOP/audit — local PASS, 2026-10-29

Protocol v1.3 / ADR-0072 explicitly marks provider-confirmed physical results.
Implemented command identity/arguments/timeouts, bounded idempotency/history,
resource exclusion, cancellation, immutable terminal phases and quarantine until
physical release/recovery. Stop revokes authority through Safety without a lease;
receipt and confirmed result are distinct, and offline is never confirmed.
JSONL audit uses a bounded worker queue, separate file thread and bounded rotation;
write/overflow failure revokes motion while Stop remains available. Typed target
values, command args, client/fence/phase identity are recorded without lease tokens.

Final local capped-container suite: **57 tests PASS / 6.286 s**. Includes actual
gRPC command feedback/state, cancel/late result, stream disconnect, dedup/resource
rejection, offline/stop latch/reset, 1000 valid ordinary Control dispatches unread
by the application, actual JSONL reads and actual readonly-file write failure.
Separate deterministic audit queue overflow injection verifies no motion is
enqueued after synchronous revocation. The earlier separate transport fixture
also leaves 969 large ordinary writes actually backpressured while Safety works.
The production queue is bounded and conflicting body commands are rejected, so
the 1000-dispatch stress uses valid lease notices, not 1000 admitted body motions.

Retained failures: first run exposed Invoke cancellation while grpc context flag
was not yet set; explicit CancelledError handling fixed it. A later synchronous
audit-fault guard initially blocked explicit ResetStop; the existing recovery test
failed and the guard was corrected. No assertion or timeout was loosened. Logs:
robotics/runtime/m23/command-tests-failed-stream-cancel.log,
commands-failed-recovery-guard.log and commands-verified-tests.log.

These are provider-wire fixtures, not physical ROS evidence. Provider-side
deadline/fence/cancel enforcement is T06, process restart faults T08, actual dog
physics/Brain safety M24. T06 may start; complete M23 gate remains OPEN.

GitHub checkpoint at 6820cc1a: main CI run 40884262378 SUCCESS and Robotics run
40884262671 SUCCESS. T05 source follows that checkpoint and requires its own CI.
