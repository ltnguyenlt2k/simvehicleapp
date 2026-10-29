# Protobus v1 contract and first implementation constraints

Status: initial wire baseline, M23-T01. No production broker acceptance yet.

The source proto is compiled independently into every consuming image. Generated
Python stubs are not copied from another product module. `grpc_tools.protoc` is
the compiler/lint gate; field numbers are public and never reused. Additive unknown
fields must survive decode/re-encode. New semantic requirements require a version
or ADR update. gRPC/protobuf pins were verified against official PyPI metadata on
2026-10-29: grpcio/grpcio-tools 1.85.0 (Python >=3.10), protobuf 7.36.2.

## Timing and stream boundaries

V1 supports SIM providers on the same Linux host only. `host_clock_id` is the
Linux boot ID; mismatches are rejected. Broker lease/setpoint deadlines use
`time.monotonic_ns()`. Dispatch carries an absolute monotonic deadline and sequence,
not merely a relative TTL that could be extended by queued delivery. ROS source
timestamps are labelled with clock and source epoch, never used for lease expiry.
REAL/distributed-clock support requires a new design and hardware commissioning.

Provider.Attach carries inbound telemetry and results. Provider.Control is a
separate outbound ordinary-control stream with bounded scheduling. Provider.Safety
is an additional stream opened on a separate gRPC channel/TCP connection for STOP
and safeValue, so already-buffered ordinary control cannot block its connection
flow-control window. Protocol version 1.1 (ADR-0070) requires both streams before
a provider is control-ready. No arbitrary
code, ROS topic name or endpoint is supplied by workflow input. A provider session
must handshake its catalog, profile, SIM backend and clock ID before control.
Provider reconnect invalidates old state/authority and cannot replay motion.

Python providers set `grpc.use_local_subchannel_pool=1` on the safety channel;
separate Python Channel objects alone may share a global subchannel/connection.
Wire feasibility tests assert distinct TCP peers and stalled ordinary writes.
Official channel argument: https://grpc.github.io/grpc/core/channel__arg__names_8h.html.
This wire-only test does not substitute for production broker/ROS STOP faults.

Lease requests use catalog hash and client ID. Token + broker epoch + fence are
required for each write; monotonically increasing target sequence rejects replay.
Client loss is bounded by lease expiration, not inferred from unrelated unary RPC
completion. Provider loss and lease loss invalidate active motion. Lease renewal
does not renew a setpoint. STOP requires no lease, clears queued motion and revokes
authority. Replies distinguish requested/dispatched/robot-confirmed; offline is
never reported as confirmed stop.

## Data semantics

Get/Subscribe require an exact catalog hash. Subscribe emits initial snapshot and
value OR quality changes, including OK -> STALE with unchanged values. Each
subscriber is bounded; telemetry can coalesce newest values, control cannot
silently drop. `min_interval_ms` limits delivery and must not hide a safety-quality
change. Missing/unavailable values use NONE; NaN/Inf do not become fabricated zeros.
Provider samples have per-path sequence and source epoch; duplicates/out-of-order
data are rejected. JSON int64/uint64 fields are decimal strings, as protobuf JSON
mapping specifies. Atomic setpoints use Object, never independent field writes.

Command state transitions:

| Current | Allowed next |
|---|---|
| PENDING | ACCEPTED, REJECTED, FAILED, CANCELLED, TIMED_OUT |
| ACCEPTED | RUNNING, SUCCEEDED, FAILED, CANCELLED, TIMED_OUT |
| RUNNING | SUCCEEDED, FAILED, CANCELLED, TIMED_OUT |
| SUCCEEDED / FAILED / REJECTED / CANCELLED / TIMED_OUT | none |

Terminal state is immutable, including late provider updates after timeout. Every
update is correlated by execution ID and provider session. Status.* is the latest
execution snapshot for that command; execution-specific truth is its Invoke stream
and audit trace. Body/navigation commands share a resource: a second conflicting
behavior gets an explicit rejection until previous physical cancellation/recovery
is confirmed. Brain remains final authority and must also arbitrate against its GUI.

## Diagnostics (public, append only)

PB_CATALOG_MISMATCH, PB_INVALID_PATH, PB_INVALID_KIND, PB_INVALID_VALUE,
PB_LEASE_REQUIRED, PB_LEASE_BUSY, PB_LEASE_EXPIRED, PB_REPLAY,
PB_PROVIDER_OFFLINE, PB_PROVIDER_MISMATCH, PB_CLOCK_MISMATCH,
PB_RESOURCE_BUSY, PB_TIMEOUT, PB_CANCELLED, PB_STOPPED,
PB_QUEUE_FULL, PB_BAD_TRANSITION, PB_BACKEND_FORBIDDEN.

M23 production code and fault tests must exercise every invariant. Passing the
transport benchmark does not accept broker safety.
