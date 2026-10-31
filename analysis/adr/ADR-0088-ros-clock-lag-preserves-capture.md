# ADR-0088 — Preserve captured values while ROS clock delivery catches up

Status: implemented, live gate candidate2026-11-01.

## Problem

The complex Studio run completed two LIFT/BOW cycles and forward/reverse Holds, then lost the provider lane during Disarm. Audit reported PB_REPLAY. A received sensor can temporarily lead the separately delivered `/clock`. DogBackend previously changed its quality to NONE, so ProviderClient emitted no value; clock catch-up then emitted the captured value under the same original stamp. The broker correctly rejected this as a changed capture.

## Decision

For a valid captured observation in the current epoch, missing/lagging clock marks it STALE while preserving its original value/stamp. It remains untrusted until both host and ROS freshness checks pass. An originally missing value remains NONE. Old epoch or wrong clock domain still fails closed; no timestamp synthesis, changed broker replay rule, increased freshness budget or automatic authority reacquisition.

Provider packet rejection diagnostics include bounded broker code/detail. No wire or installed SDK change; runtime package remains pinned.

## Evidence

A new actual gRPC regression uses production ProviderClient serialization and broker ingestion. Old code fails PB_REPLAY `value changed without a new capture`; corrected code publishes STALE→OK with the same value/stamp and retains the provider lane.19 broker-data groups,166 provider groups and9 actual DDS groups pass. Complex37-node native/ROS UI runs then finish all motions, Disarm and confirmed Stop. M27 sustained live gate records remaining stability acceptance.
