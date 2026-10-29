# Robot Studio
Independent stack under implementation, ADR-0069–0073. Current increment: RSS,
Protobus broker, synthetic mock provider and diagnostic CLI. The 30-minute
transport feasibility gate and local broker/provider/CLI checks passed; process
faults and CI are tracked in M23. Workflow deployment, live ROS integration and
Studio remain later gates. Hardware unsupported.

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
