# ADR-0069: Deploy workflow artifacts and launch from Robot Zoo through independent interfaces

- Status: Accepted — direct PO implementation instruction 2026-10-29
- Related: ADR-0064–0068; supersedes conflicting implementation details, not independent-stack requirement.

## Context
The user authorizes changes in both repositories. Final flow: design a complex workflow on Robot Studio, verify canvas, build, create project/deploy, open a new Robot Zoo tab, explicitly launch the deployed logic, observe actual simulation and collect a complete video. The review R01–R08 must be resolved before freezing contracts.

## Decision
1. Keep project-owned code independent; no cross-repo runtime source imports/cloning. Share versioned wire interfaces and pinned build artifacts only. Hardware is disarmed and outside scope.
2. Separate sr-sim-bus and sr-live-bus, separate runner services, fixed endpoints and mode-scoped credentials. Sim/test cannot reach live. Studio API is a checked control-plane boundary.
3. Broker safety uses monotonic clock, bounded queues, provider epoch, lease fencing and command sequence. ROS capture/envelope time uses ROS clock and boot/scene epoch. Reconnect invalidates authority and never replays motion.
4. STOP invalidates pending motion, dispatches over a priority control path and reports requested/dispatched/robot-confirmed separately. Provider loss cannot be reported as confirmed stop. Record end-to-end latency under saturation.
5. One active body/navigation owner including behaviors within an app; conflicting commands are rejected or explicitly cancelled before handover. Dog arbitrates external source ownership against GUI manual commands; STOP/disarm remain available.
6. Subscribe sends snapshot, values and quality changes; stale/NONE values cannot trigger movement implicitly. Out-of-order samples rejected. Command terminal states immutable, cancel/timeout races correlated by execution ID.
7. timeScale=1 in v0.1. Mock parity is contract/trace parity, not physical equivalence. Scenario reset is isolated and explicit.
8. Deployment stores immutable workflow/source/catalog/profile hashes and runtime version. Deploy does not arm or start. Link to Robot Zoo carries deployment identity, never executable source or arbitrary callback URL.
9. Robot Zoo offers explicit Start deployed workflow, status, logs and Stop through an allowlisted control-plane interface. Runtime sends high-level commands via Protobus; bridge only publishes control/request. Brain retains final authority.
10. Runtime REAL remains unavailable. SIM Arm requires explicit run/deployment action with approved profile, no automatic startup arm.
11. Dog compatibility is pinned to current source SHA 25b4bfada838b25ab93cf73c658c356a8ab90ef9 plus subsequent documented integration changes. Build interface package from a reviewed local export with checksums/license, no private runtime clone. CI needs artifact or authorized source access.
12. Existing vehicle AI is optional assistance, not a prerequisite or dependency of the independent robot stack. The mandatory video can create the workflow manually; no mocked AI success.

## Verification
- M22 foundations/spec and DDS/interface/envelope spikes before M23.
- M23 broker safety/fault/performance gates before bridge and compiler integration.
- M24 live adapter gate, M25 compiler/mock gate independently; combined live gate before M26 Run.
- M26 technical UI gate distinct from final M27 acceptance. M27: complex canvas-to-build/deploy-to-Zoo-start flow, ROS pose/command/terminal assertions, STOP and reconnect faults, three full live runs, 30-minute soak, video, current guide.
- Complex acceptance workflow: explicit setup/Arm, condition + debounce, bounded loop, sequential motions, wait, conditional branch, concurrent read-only monitoring with priority STOP, success/failure/timeout cleanup. Actual reachable scene/capability preconditions; no forged sensor success.

## Consequences
Both repositories change through interfaces, deployment and execution remain separate, and failures stay visible. Every milestone records commands, source/image hashes and actual outcomes; no skipped gate or hardware acceptance from simulation.
