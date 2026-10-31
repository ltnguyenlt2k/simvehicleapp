# Robot Studio
Independent robotics stack: RSS, Protobus1.6 broker/providers, deterministic
RobotFlow compiler and installed native Python runtime development preview.
M24 historical ROS/physics gate and M25 compiler/runtime/conformance checkpoints
are recorded; fresh Ubuntu recovery passed broker165/compiler38/runtime62 and
12 conformance cases twice. See [runtime preview](rfrt/README.md) and
[environment recovery](../docs/reports/environment-recovery-2026-10-31.md).
Live generated workflows, Robot Studio deployment UI and final continuous video
remain under implementation. Hardware is unsupported.

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

Native developer workflow CLI: `sr build FLOW.json --out NAME`, explicit `sr target --sim|--live --out NAME`, then `sr run --sim|--live NAME --target NAME`. See the [user guide](../docs/user-guide/robotics.md#build-và-chạy-ứng-dụng-robotflow-native-bản-phát-triển) and [capture/CLI checkpoint](../docs/reports/M25-capture-cli-checkpoint.json). Live native workflow acceptance remains separate.
