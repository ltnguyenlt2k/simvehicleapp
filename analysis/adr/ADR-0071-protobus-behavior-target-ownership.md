# ADR-0071: Hold ownership and explicit safe release inside one app lease

- Status: Accepted under PO delegation 2026-10-29.
- Related: ADR-0066, 0067, 0069, 0070; M23-T04.

## Context and decision

A lease distinguishes apps but cannot distinguish two concurrent behaviors in
one workflow. Protocol v1.2 therefore adds Target.owner_id and Target.release,
and Dispatch.owner_id, preserving all existing field numbers. Each Hold instance
uses a stable, nonempty owner ID. A different owner cannot overwrite an active
target. Explicit release requires the exact catalog safeValue, dispatches on the
safety lane and relinquishes that Hold resource. TTL expiry does the same.
Command body/navigation exclusion is additionally enforced in T05.

LEASE_UPDATE on Control carries the granted/renewed absolute lease deadline;
LEASE_REVOKED on Safety invalidates that fence even if no setpoint is active.
Providers must not infer lease renewal from an unrelated heartbeat or extend a
target deadline when its lease is renewed. This makes downstream Brain authority
possible without sharing broker implementation state across repositories.

Acquire gives a random token, increasing fence and broker epoch; renew preserves
the original bounded lease duration, not any client-provided remaining_ms.
Renewing a lease never renews a setpoint. Each target has a strictly increasing
lease-wide sequence and an absolute same-host monotonic deadline bounded by both
the lease and the catalog TTL. Release/expiry purges queued old authority and
dispatches safeValue once. A provider rejects expired or old fence/sequence data;
an old safety dispatch must not override a newer lease/target. STOP remains a
separate global revocation and does not depend on a Hold owner.

V1.2 permits at most eight setpoint nodes per catalog. Safety dispatches coalesce
by path and preserve STOP, keeping a bounded lane with enough space for every
declared setpoint. Velocity safeValue must be zero, and every safeValue is checked
against its field types/ranges before startup. Catalog and control input fail
closed. The initial deployment remains local SIM only and disarmed by default.

## Verification

Actual gRPC tests cover contention, renew/release, expiry, stale tokens, broker
epochs, replay, complete typed targets, competing Hold owners, explicit release,
TTL not extended by lease renewal, provider/lane loss and exactly one safe-value
dispatch within TTL +50 ms. T06 provider tests must additionally exercise
out-of-order cross-connection delivery and provider-side fencing; T04 broker tests
alone are not end-to-end robot safety acceptance.
