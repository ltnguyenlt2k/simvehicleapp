# ADR-0083: Hold admission and correlated safe release

Status: Accepted design for M25-T06 prerequisite implementation under user
delegation, 2026-10-31. NOT IMPLEMENTED; no new wire/runtime gate accepted.

## Finding

SetTarget currently returns a broker receipt only. Provider applies targets later
and ROS manual admission occurs in its separate refresh loop. A short Hold could
finish before its nonzero target is ever admitted. Release removes the broker
owner and queues safeValue, but gives runtime no correlated backend confirmation.
Do not report Hold SUCCEEDED or hand the body to another command from Reply.ok,
an elapsed duration or an unrelated latest zero-velocity sample.

## Decision for the next implementation

Use a versioned additive protocol extension, with a bounded Hold execution record
per unique (provider session, fence, path, owner). SetTarget Reply appends an
operation ID, stable across refresh/release retries for that Hold. Dispatch uses
its existing execution_id and sequence to correlate backend feedback; append a
target_sequence to CommandUpdate. InspectExecution exposes the Hold record,
accepted sequence, last sequence, owner and release-requested state. Preserve all
existing field numbers and catalog bytes; this is a transport extension, not a
new RSS signal or a fake command status path.

Normal target feedback proves actual backend/Brain admission; it is not physical
displacement evidence. Runtime starts duration only after the first target is
admitted, maintains complete values at refreshHz, and releases with a strictly
higher sequence on every exit. Ambiguous RPC completion consumes the sequence;
retry does not replay or extend the original cleanup deadline.

Explicit release keeps the body quarantined until the same session/fence/owner/
release-sequence has correlated safe backend feedback. ROS confirmation requires
fresh matching source context, actual admitted zero command, observed safe output
zero and no active physical motion; body standing recovery remains mandatory
before a subsequent Perform. Mock confirmation is explicitly synthetic. Keep safe
output timing separate from physical coasting/standing time in reports.

A late old admission cannot rewrite a confirmed release. A timeout establishes an
immutable logical terminal, requests independent Stop and leaves physical release
unconfirmed. A recovered ResetStop may clear resource quarantine, but cannot
fabricate an older correlated physical terminal. Histories/owners are bounded;
never evict an unconfirmed active resource to admit new work.

Safety dispatch cannot wait behind normal target admission. Provider must retain
its independent safety channel and local lease/target deadlines; late ACKs cannot
restore a revoked session. Normal target application and release feedback own and
await their asynchronous tasks; process loss must not fabricate confirmations.

## Other required dependencies

Ordinary explicit Cancel must preserve a still-valid Brain grant only after
correlated cancellation/recovery; Stop/timeout/loss must revoke. Propagate typed
cancellation cause and execution identity to the backend, escalating a normal
cancel if authority is lost during recovery. Runtime must distinguish an expected
explicit cancellation from an unexpected command failure without swallowing a
failed cleanup or auto-continuing another loop iteration.

ROS capture-age/future-stamp/clock-freeze/epoch-cutoff qualification remains open.
Do not compare ROS source timestamps to host monotonic clocks. The runtime must
still reject changed context/session and must not reacquire/replay after loss.

## Required verification

Actual gRPC tests: non-admitted short Hold cannot succeed; wrong/old feedback
identity or sequence cannot release; release receipt alone remains quarantined;
retries are bounded/idempotent; late admission cannot undo release; concurrent
Stop bypasses blocked normal admission; timeout/loss emits safe Stop and cannot
resume. Real broker/mock conformance then actual ROS target admission/release,
ordinary Cancel handover, source-fault tests and final complex workflow/video.

Next action: implement transport records/feedback and backend admission/release
confirmation, qualify them before completing BusClient/Hold and runtime wheel.
