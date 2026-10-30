# ADR-0082: Actual provider identity and scene/map deployment context

Status: Accepted for M25 runtime integration under user delegation, 2026-10-31.
Protocol candidate 1.5; actual live acceptance remains OPEN.

## Context

A profile name cannot prove which mapping or adapter code is running. Runtime
must distinguish a kinematic mock from ROS physics and must not continue an old
deployment across a changed map, Brain or provider session.

## Decision

Add closed typed TargetContext to ProviderHello and Descriptor, preserving all
existing field numbers. Explicit kind is KINEMATIC_MOCK or ROS_SIM; unspecified
and incomplete contexts are rejected. Include actual canonical mapping/profile
hash and actual adapter source identity. Source identity hashes the image's own
top-level Python source files and Protobus proto bytes, canonically by path.
Immutable image code is measured once per process; no declared arbitrary label
stands in for source measurement.

ROS context includes observed Brain boot/config, source/scene epoch, scene ID,
map generation and remote Arm authorization. Do not invent these for mock; mock
identifies its actual measured profile and current transport source epoch, and
may not claim Brain/physical-map fields. ROS mapping hash includes the effective
authorization flag. Remote Arm authorization remains separate from graph Arm,
lease acquisition and the observed Brain grant; none auto-Arms on startup.

Provider checks its context every100ms; a map/context change cancels owned work,
fails safe and replaces its session. Runtime must stop an existing run on any
provider/broker/source context loss and cannot auto-resume or reacquire. A new
explicit launch verifies deployment binding again. Immutable deployment binding
includes actual mapping/source/kind and ROS scene/Brain/map context; transient
clock samples and provider session belong to the run record. Mock transport
source epoch is transient too. Get/Subscribe batches expose the current provider
session, preserving on-change subscription semantics.

## Verification

Require actual socket tests for descriptor data equality, wrong/missing context,
mock versus ROS, session changes and map changes. Metadata unit tests do not
establish ROS mapping correctness or final runtime behavior. Requalify the new
adapter/broker against actual DDS/physics and final workflow soak before claiming
live acceptance. The existing live production1.3 stack remains unchanged during
candidate qualification. Normal cancel/freshness/capture/clock gates stay open.

Actual source identity additionally includes pinned dependency locks, interface manifest and control/unit contract bytes. Actual producer map_generation is a bounded string, preserved exactly. Verification: RSS22/broker123 PASS, Humble backend8/bridge4 PASS, actual read-only DDS observer9frames PASS; no live control acceptance. Original mutable-profile fixture and ROS infrastructure-publisher assertion failures are retained.
