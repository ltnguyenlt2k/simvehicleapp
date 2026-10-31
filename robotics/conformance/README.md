# Native runtime conformance

Linux Docker host orchestration; test-only synthetic kinematic model. Runtime
imports only installed rfrt and generated wire. It never imports broker/provider
implementation. Compiler exports native files in its own offline image with the
measured wheel pin. Fixture files/logs belong to ignored robotics/runtime.

Prerequisites: existing built sr-contracts/sr-robotflow/sr-rfrt/sr-protobus images
and the initialized external sr_catalog volume (normal sr catalog-init). Run
`python3 robotics/conformance/gate.py` from the repo root. The dedicated Compose
project has an internal network, no host ports, no Docker socket, readonly roots,
nonroot processes, 2 CPU/256MiB limits. Host handles fault injection and teardown.
No other project is stopped; persistent catalog is never deleted.

The fixed C-R01–12 mapping lives in analysis/phases/M25. Two rounds include
17 CLI subcases plus native verified-code lease loss and provider crash/restart.
Each case resets only idle synthetic scenario state, retains SAFE_STOP and waits
for a new provider session. No test overlaps a lease with another case. Inputs
for scenarios are mock-only; the live bridge never exposes that API.

Node spans, immutable lock identity, phase branches, confirmed target release
before handover, event replay, invalid input, SIGTERM, typed units and six Patrol
commands are asserted from actual execution. Global Stop confirmation remains a
separate proof from Hold release. These tests do not qualify ROS or hardware.
