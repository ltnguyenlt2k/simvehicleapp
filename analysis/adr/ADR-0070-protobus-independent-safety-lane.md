# ADR-0070: Protobus uses an independent provider safety connection

- Status: Accepted under PO delegation 2026-10-29 (user authorized independent solutions through final completion).
- Related: ADR-0066, ADR-0069; M23-T01 refinement before production implementation.

## Context

Separating telemetry from control prevents bulk samples from queuing ahead of
STOP, but does not isolate STOP from ordinary control dispatches already buffered
in the same HTTP/2 stream or connection. A priority queue cannot reorder bytes
already sent. This is a concrete gap in the previous Provider.Control plan.

## Decision

Add Provider.Safety as a server-streaming RPC. Providers open Safety on a separate
gRPC channel/TCP connection from ordinary Control and Attach traffic. STOP and
safeValue use only this bounded safety lane. STOP invalidates queued motion and
prior authority. Both lanes must be ready, session/clock/catalog matched and fresh
before accepting control. Provider loss cannot produce false robot-confirmed STOP.
Control already in flight is rejected after revocation by epoch/fence/sequence and
downstream Brain authority; that behavior requires actual fault evidence.

The additive wire contract advertises protocol_version 1.1 on descriptor/provider
hello. Broker v1.1 refuses providers without this capability. Existing field
numbers, values and diagnostics remain unchanged; no field or RPC is removed.
The transport feasibility spike does not exercise or qualify safety guarantees.

## Verification

Wire descriptor tests cover the additional server-streaming RPC. Production fault
tests must stall ordinary Control, saturate queue/transport, send STOP and observe
actual provider receipt through Safety and downstream robot confirmation with
bounded latency. Reconnect never replays old movement.

## Alternatives

One priority queue cannot affect already-written messages. A second stream on the
same channel retains connection-level backpressure. A dedicated connection is
chosen for local SIM v1.1. Software STOP remains distinct from a physical E-stop;
hardware commissioning stays open.

## Initial wire evidence (not production safety acceptance)

2026-10-29: grpcio 1.85.0, actual loopback sockets, separate server-streaming
Control and Safety. Python safety channel uses grpc.use_local_subchannel_pool=1;
server peers are asserted different, since Channel objects may otherwise share
the global subchannel pool. With 969 ordinary writes still pending after actual
backpressure, a STOP was received on Safety in 2.868 ms in the measured trial.
Six protocol/transport tests passed in the capped 2-CPU/256-MiB image. The test
service is deliberately not the production broker and does not confirm a robot
stop. Production saturation/authority/replay tests and actual ROS remain required.
