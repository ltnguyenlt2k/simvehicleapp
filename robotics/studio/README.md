# Independent Robot Studio — implementation in progress

M25 native compiler/runtime gate is closed; M26 UI/deployment and M27 final video
are still being implemented. The current web entry is a technical200-node spike,
not the finished workflow editor. All work runs in WSL Ubuntu.

Local T01 checks: frozen static build, headed Chromium canvas, nonroot native
supervisor, actual mock motion/Stop, real cgroup OOM recovery and mode network
denial. Run `python3 robotics/runner/spikes/qualify.py` after building the runner
image. It creates only a dedicated isolated fixture and always tears it down.
No ROS/motion/hardware inference may be drawn from that kinematic fixture.

Build web builder/static/browser images using their pinned Dockerfiles and run
`docker compose -f robotics/studio/spikes/compose.yaml up -d web`, then its
`--profile tools run --rm browser`. Set SR_DEV_UID/GID to the Linux evidence owner
when it differs from1000. Browser init is required for Xvfb signal/reaping behavior.
Only the benchmark web is published locally on3180. No application launches.

`robotflow/service.Dockerfile` adds a pure HTTP compiler; six ASGI groups and four
actual TCP/installed SDK integrity checks pass. It returns immutable file sets,
never executes them. Request shape, Arm compilation policy, strict JSON and body
budgets are checked. Final Studio API/runner control integration remains separate.

Exact local evidence: docs/reports/M26-spikes-checkpoint.json. Candidate CI must
qualify new services; final service network boundaries are rechecked before Run.
