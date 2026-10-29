# Complex RobotFlow deployment acceptance

Status: planned acceptance, not an implemented feature or passing result.
Authorized by the user 2026-10-29. Complements ADR-0069 and M24–M27; it does not
permit starting those milestones before their prerequisites pass.

## Final user journey

1. Open Robot Studio, create a named project from an empty canvas. Add and connect
   the complex workflow with actual pointer/keyboard actions. AI may propose a
   graph when explicitly supported, but manual graph creation is sufficient and
   no fabricated AI response may appear in the video.
2. Inspect typed props, ports, RSS paths and error branches on canvas. Show a real
   invalid property diagnostic, correct it, then lint/build successfully. Confirm
   source/IR/catalog/profile/runtime hashes in the resulting project artifact.
3. Simulate and Test through the mock provider. Include a scenario that exercises
   the alternative/error path and proves PASS/FAIL assertions actually fail when
   expected. Mock results are labelled as such and cannot count as live evidence.
4. Deploy the immutable artifact to the SIM runtime. Deployment alone must leave
   the dog disarmed and motionless. Open Robot Zoo in a new tab through the product
   button. The tab identifies the deployment, target SIM robot and current run.
5. Click the explicit Start deployed workflow action once. The deployed graph,
   not a hardcoded demo routine in the dog GUI, drives the external runtime via
   Protobus. Observe pose, safe command and correlated motion results from ROS.
6. Show live runtime/node trace and robot motion side by side; demonstrate Stop
   and its confirmed robot state. Export artifact and test/run evidence.

## Workflow RW-E: bounded inspection routine

Target at least 25 visible nodes, multiple behavior roots and typed result ports.
The exact reachable coordinates and durations are fixed only after M24 capability
and frame checks; do not guess map coordinates from odometry or ground truth.

Main behavior:

- On explicit start, log deployment/run identity and wait for healthy connection,
  fresh safety mode and required observations with a finite timeout.
- If battery is healthy, Arm with explicit SIM run authorization; otherwise take
  a logged refusal/cleanup branch without movement.
- Execute a bounded loop twice. Each iteration logs its index, evaluates fresh
  obstacle clearance, performs a short bounded Move or takes the refusal branch,
  returns the setpoint to zero and waits for stable standstill. Perform BOW then
  LIFT_FRONT_LEFT (or another actually qualified motion) with separate succeeded,
  rejected, failed and timed-out branches and explicit cancellation cleanup.
- Include a wait-until with finite timeout and a conditional branch using a real
  RSS observation. No unbounded hot loop, no direct motor output.
- Log completion and Disarm. Every failure path cancels/zeros and disarms or
  latches Stop as appropriate; it never logs successful completion on failure.

Concurrent monitoring behavior:

- Watch fresh obstacle distance and connection/safety quality while main work
  runs. Debounce the applicable condition and use the independent priority Stop
  operation. STOP is outside the motion resource lock and does not wait for the
  main behavior. Low battery and stale telemetry must have explicit safe paths.
- A live normal run need not invent an obstacle or battery event to cover every
  monitor branch. Cover those branches in dedicated mock and actual fault cases,
  and keep their evidence distinct.

M24 additionally qualifies GoTo/route map-frame navigation independently. RW-E
may include navigation only with the same resource/cancel/readiness semantics and
verified reachable waypoints; its complexity must not be reduced to a single
motion or a hardcoded list outside the compiled graph.

## Required authoritative assertions

- Canvas nodes/edges/properties survive save/reload; compiler rejects invalid
  ports, units, kinds, unreachable required paths and unsafe bounds.
- Artifact deployed is the artifact built, and runtime trace hashes match it.
- Deploy causes no Arm/manual/goal/motion request. Explicit launch causes exactly
  one run; a second launch is rejected. Wrong deployment/target/mode is rejected.
- Each loop iteration and conditional outcome is visible in node trace. Expected
  ROS request IDs correlate to ACK and actual terminal state; ACK alone cannot
  satisfy a motion assertion.
- Observed odometry changes consistently with the actual safe velocity request;
  motion feedback confirms physical execution, and zero/Disarm is observed at end.
- STOP, app kill, lease loss, provider loss, broker restart, bridge restart,
  duplicate command, stale sensor and paused/reset ROS clock have bounded outcomes
  with no unintended replay/resume. Record failures and retries without loosening
  thresholds. Software STOP is not a physical E-stop.
- Run the complete live journey three consecutive times on the qualified image;
  separate restart/fault evidence and 30-minute soak. No mocked HTTP response may
  stand in for ROS or physical SIM evidence.

## Video requirements

Record actual browser actions at readable speed, with visible cursor and labels,
from empty project through canvas validation/build/deploy/new Robot Zoo tab/Start,
physical SIM behavior, trace and confirmed Stop. It may use an E2E recorder or
Playwright. Capture the workflow and robot together during execution. Preserve
the full recording under runtime, validate complete decoding, and publish a
usable final video plus updated README/user guide. A montage of isolated tests,
an obsolete interface or a motion-only clip does not fulfill the user journey.
