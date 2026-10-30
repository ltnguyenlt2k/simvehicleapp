# Robot Studio
Independent stack under implementation, ADR-0069–0075. Current increment: RSS,
Protobus broker, synthetic mock provider, diagnostic CLI and development live
ROS/MuJoCo adapter. Workflow deployment and Studio remain later gates. The M24
live fault/equality/1800-second gates passed and CI qualified M24. RobotFlow
schemas/registry are in progress; no workflow runtime is available yet.
Hardware is unsupported. See M23/M24 reports for exact scope and evidence.

From the repository root, run `bash robotics/scripts/sr build`, `precheck`, `test`
and `smoke` for RSS foundations. Broker data/protocol tests: build the contracts
image first, then `docker build -t sr-protobus:dev robotics/protobus` and
`docker run --rm --network none --cpus 2 --memory 256m sr-protobus:dev`.
Full execution evidence and remaining gates: `docs/reports/M23-progress.md`.

Start only this stack with `bash robotics/scripts/sr up`. Wait for broker/mock
health, then `bash robotics/scripts/sr pbctl describe`. The provider starts
DISARMED. `bash robotics/scripts/sr down` preserves catalog/audit volumes.
The internal mock scenario API is never exposed on a host port. Access broker
diagnostics through the container CLI: Docker versions may suppress published
ports on internal networks, so host localhost access is not an acceptance claim.
See [Protobus CLI](protobus/README.md) and
[robotics user guide](../docs/user-guide/robotics.md).

`python3 robotics/scripts/fault-test.py` intentionally kills/restarts only this
stack's broker/provider and disconnects its mock network. It requires Docker
access on the host and leaves a healthy, stopped stack (SAFE_STOP or DISARMED) after verification.
Evidence goes under ignored `robotics/runtime/m23/process-faults/`.

## Live ROS/MuJoCo development profile

`bash robotics/scripts/sr build --live` builds the pinned independent Humble
adapter. Start the dog stack separately on domain 52, then run
`bash robotics/scripts/sr up --live`. This selects only the live broker/provider
and catalog initializer, with its own internal bus/audit volume. It does not
start the mock. `sr pbctl --live describe|get|subscribe|stop` (same script path)
targets the live broker. Set `SR_ROBOT_NETWORK` to select the external dog Docker
network (default `dog-ros2-r1_robot`). Compose must support `interface_name`;
DDS uses eth0 and the internal broker bus eth1.

Remote Arm defaults off. `SR_AUTHORIZE_SIM_ARM=true bash robotics/scripts/sr up
--live` explicitly permits later Arm requests for local SIM; startup still never
claims, resets, arms or resumes motion. Invalid true/false configuration fails
startup. Host ports bind localhost only; use the container diagnostic CLI because
internal-network port publishing varies by Docker version. Workflow Studio,
deployment and final video remain pending. Follow [M24 progress](../docs/reports/M24-progress.md).
