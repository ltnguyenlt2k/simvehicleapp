# ADR-0089 — Existing SimVehicleApp GUI, independent robotics execution layers

Status: authorized by the user's explicit correction2026-11-01. Implementation OPEN.

## Correction

The user explicitly requires integration into the existing repository and GUI of simvehicleapp, not a new Robot Studio. Independent layers mean separate responsibilities and versioned interfaces; they do not require a second product/editor. This latest instruction supersedes the UI-reuse prohibitions in ADR0064, the standalone web application decision in ADR0068 and conflicting design/roadmap assertions. Historical statements attributing a separate GUI to the user are not operative requirements.

The previous standalone GUI and its MP4 fail the requested product acceptance. Its backend unit, protocol and physical safety evidence remains technical evidence for those individual layers only. Do not mark the overall integration complete from that video.

## Required architecture

1. The sole authoring GUI is `modules/simvehicleapp-studio/apps/sim`: existing workspaces, workflow persistence, canvas, palette, properties, signals, assistant, validation, project/build/deploy and run views. No separate Robot Studio application, replacement editor, iframe or link to another authoring portal.
2. Add an explicit robotics/RSS workflow domain and UI adapter within that GUI. Existing vehicle/VSS workflows retain their defaults. Domain selection is persisted and validated; RSS cannot silently fall back to VSS or cross into a vehicle execution target.
3. The canvas adapter preserves node IDs, every named result port, typed properties, variables/units and graph topology when producing `robotflow.v1`. It does not compile or interpret robot behavior in the browser. Round-trip and rejected mixed-domain graphs need tests before UI wiring.
4. GUI/server adapters consume versioned HTTP/WS/SSE contracts. They do not import robotics compiler/runtime/broker implementation. Existing collaboration realtime stays a collaboration layer and cannot issue actuator commands.
5. RobotFlow compiler, native runtime/runner, Protobus, ROS2 adapter and Dog runtime remain independent layers. Preserve immutable builds/targets, separate mock/live buses, single body owner, no automatic Start/replay, and priority Stop.
6. The existing GUI's assistant uses the selected domain's catalog/blocks/lint capabilities. A model only proposes reviewable graph edits; it never enters the execution or deterministic compilation path.
7. Build/deploy in the existing GUI must bind its saved workflow/project revision to the native artifact. The deployment can open the existing Dog GUI in a new tab, carrying only deployment identity. Explicit Start there runs that exact artifact.

## Correction sequence and gates

- I01: inspect existing GUI, persistence, contracts, compiler hooks, AI, realtime and deploy paths; document concrete adapter points and migration.
- I02: domain contracts and lossless canvas/registry adapter, with pure contract/round-trip tests and vehicle regression checks.
- I03: integrate the existing palette, properties, RSS selection and diagnostics; authenticated backend interface and workflow ownership checks.
- I04: integrate existing project/build/test/run/deploy/export and assistant capabilities through domain adapters; preserve backend safety boundaries.
- I05: real browser tests through the actual SimVehicleApp GUI, actual ROS/Dog run, restart/Stop checks and a replacement continuous MP4. The old recording cannot satisfy this gate.

No product-completion or release tag until I01–I05 pass. Retain previous implementation/history for review; retire the separate authoring frontend after the replacement integration is verified.
