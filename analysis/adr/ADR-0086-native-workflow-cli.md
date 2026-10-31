# ADR-0086: Explicit native application build, commissioning and launch CLI

Status: implementation under user authorization; acceptance pending.

`sr build` and `sr build --live` retain image-build behavior. `sr build FLOW.json
--out NAME [--authorize-sim-arm]` uses the pure compiler image, an explicit SIM
profile and the installed runtime wheel identity. The compiler returns text files;
only the host CLI writes a new immutable application directory under ignored
`robotics/runtime/apps`. Existing names are never overwritten. Compilation grants
no lease, never Arms and cannot change provider commissioning policy.

`sr target --sim|--live --out NAME` records a currently healthy descriptor through
the installed SDK. It neither acquires authority nor changes the target. The record
is immutable under `runtime/targets`. `sr run --sim|--live NAME --target NAME` uses
that saved record and existing verified launch path. It never refreshes a binding
implicitly. SIM is the kinematic mock; live means the ROS-connected SIM only.

Fixed Compose services restrict each mode to its own internal bus. Non-root,
read-only filesystem/artifacts, dropped capabilities, no Docker socket, bounded
memory/CPU/PIDs and no arbitrary bus override apply. The existing compiler profile
and runtime impose a bounded run deadline; event input is strict rfevent.v1 JSONL.
A second controlling run is refused by existing robot authority. This CLI is a
local developer tool; M26 adds prestarted runner control services for browser use.

Qualification requires real image builds, rejection before any output on invalid
workflow, duplicate-name rejection, explicit stale-target refusal, native RW-A..D
through both mock and actual ROS, and current runtime conformance twice. No CLI
success alone qualifies physical motion or M26/M27.
