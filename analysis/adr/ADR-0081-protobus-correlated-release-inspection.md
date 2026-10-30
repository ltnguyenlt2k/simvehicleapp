# ADR-0081: Read-only correlated physical release inspection

Status: Accepted for M25 runtime implementation under user delegation,
2026-10-31. Protocol candidate v1.4; actual live requalification remains OPEN.

## Context

v1.3 correctly preserves an immutable logical timeout/cancellation even when
physical recovery completes later. The release was visible only in private audit
state. Runtime cannot safely hand the body to another command using an early
Cancel receipt or a latest status that could belong to another execution.
STOP also needs its own receipt identity when physical completion arrives later.

## Decision

Add `Bus.InspectExecution` with exact catalog hash, broker epoch and bounded
execution ID. It is read-only, requires no lease (STOP revokes it), grants no
authority and returns no lease secrets. Response separates immutable logical
phase from independently correlated physical phase/release, path, provider
session and original fence. Unknown/evicted identities fail rather than falling
back to latest status. Consumers must still match the current target/session.

StopReply appends execution ID, broker epoch and provider session; existing wire
field numbers remain unchanged. Descriptor appends current provider session.
Provider/client protocol checks advance together to 1.4; old live 1.3 processes
must not be silently treated as qualified 1.4. Do not recreate the production
live stack until relevant tests pass and its source identity is recorded.

Broker resource-quarantine clearance after ResetStop remains separate from a
correlated physical terminal for an older execution. Store physical terminal
phase explicitly; never infer it from the internal `released` resource flag.
Late physical results cannot rewrite logical history, and duplicate matching
physical results are idempotent while contradictory terminals are rejected.

## Verification

Actual local gRPC transport tests cover pending/confirmed/late release, immutable
logical timeout, duplicate/conflicting physical terminals, delayed STOP without
a lease, wrong catalog/epoch/ID, and recovery that clears quarantine without
fabricating old physical completion. Existing transport/safety regression is
required. This interface alone does not qualify ordinary Dog cancellation,
deployment target metadata or live runtime behavior; those remain mandatory.
