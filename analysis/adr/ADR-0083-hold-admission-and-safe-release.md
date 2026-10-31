# ADR-0083: Hold admission and correlated safe release

Status: Accepted design for M25-T06 prerequisite implementation under user
delegation, 2026-10-31. Transport/backend candidate1.6 IN_PROGRESS; mock/socket gate passed, actual ROS gate remains OPEN.

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

Component checkpoint: targets.py adds a bounded HoldLedger with unique operation
identity, admission/release sequence checks, immutable logical timeout/physical
release, non-extending cleanup retries and no eviction of an unconfirmed resource.
Eight component groups PASS; not imported into broker/provider yet. A failed
refresh cannot falsely release an earlier admitted target. Actual RPC/backend
integration and all live Hold acceptance remain OPEN.

Wire checkpoint: candidate1.6 adds Reply.operation_id, CommandUpdate.target_sequence
and Hold inspection fields without changing existing field numbers or RSS catalog.
Broker retains quarantine after a release receipt; provider confirms actual backend
admission or safe release. Normal lane may await target admission while independent
Safety still processes Stop. Completed owners cannot resume; next Hold uses a fresh
owner. Ordinary target TTL still emits its original safe dispatch; only unconfirmed
explicit-release timeout adds independent Stop, preserving measured TTL evidence.

RSS22 and broker134 groups PASS /33.331 s, including actual gRPC receipt/admission/
release identity checks and Stop with a blocked mock admission ACK. Original first
run retained: a redundant Stop coalesced away the TTL safe dispatch; corrected
without changing its timing window or assertion. Existing fixtures now explicitly
acknowledge safe release before admitting another body owner. ROS backend methods
are implemented but await dedicated unit/actual DDS/physics qualification; no live
Hold, runtime wheel, full workflow UI or video acceptance is claimed.

Actual Hold extension qualified on two successive ROS/physics runs: safe release45.2/45.7ms, physical odom displacement0.187/0.214m, subsequent BOW and Disarm confirmed. Explicit Disarm revocation now serializes renewal to avoid misclassifying intentional grant loss; no automatic reclaim. Report M25-hold-live-checkpoint.json retains source/image and initial failure evidence. Full runtime/control-fault/GUI/video gates remain open.
