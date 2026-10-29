# ADR-0072: Explicit physical confirmation, immutable terminal state and audit isolation

- Status: Accepted under PO delegation 2026-10-29.
- Related: ADR-0066, 0069–0071; M23-T05. Additive protocol version 1.3.

## Decision

CommandUpdate adds physical_confirmed, preserving previous field numbers.
SUCCEEDED is invalid without explicit provider confirmation of the actual result.
Logical timeout/authority loss can terminate a client stream, but that terminal
phase cannot later become success. The body resource remains quarantined until
physical completion/cancellation is confirmed or explicit ResetStop succeeds on
the recovered provider. Provider rejection can confirm that execution never began.
ACK/queue admission is not physical completion.

Stop requires no lease and preempts queued ordinary control through the independent
Safety connection. Its dispatch has a unique execution ID. Provider ACCEPTED
feedback proves receipt; SUCCEEDED with physical_confirmed proves the stop result.
StopReply reports requested/dispatched/robot_confirmed separately after a bounded
wait. Offline or missing feedback never produces a confirmed result. STOP revokes
authority, terminates active client work and latches local control until explicit
recovery. Idempotent ResetStop may confirm an already disarmed, recovered robot;
it cannot merely assume recovery from a timeout or a disconnected provider.

Accepted invocation keys are scoped to the current fenced lease and prevent a
duplicate dispatch. Active command/body ownership excludes Hold targets and other
body/navigation commands. History, keys, quality/control queues and stop receipts
are bounded. Provider-side absolute deadlines and cancellation tombstones remain
T06 requirements; no delayed request may execute after cancellation or revocation.

JSONL audit runs through a bounded queue and a file worker off the asyncio control
loop. It rotates at 32 MiB with three retained segments. Audit fault/overflow
revokes motion and dispatches STOP, blocks new motion, and exposes audit_ok=false
in Descriptor; STOP itself never waits for disk and remains available. Tokens are
never logged. Buffered audit is not a crash-durable transaction journal: hard kill
may lose unflushed rows. This limitation must not be hidden as complete crash
audit evidence. Provider watchdog/fencing handles broker disappearance separately.

## Verification

Actual gRPC lifecycle, invalid phase, timeout/late result, cancellation, duplicate,
resource contention, provider loss and STOP receipt/confirmation tests. Stress
STOP with 1,000 ordinary dispatches unread by the application, plus the separate
actual backpressured transport fixture. Real JSONL and a real filesystem write
failure demonstrate audit behavior. Robot physical confirmation remains M24 live
evidence, not evidence provided by a unit-test provider assertion alone.
