# Robotics development preview

The independent robotics stack currently provides RSS contracts, Protobus and a
synthetic mock provider. Robot Studio and deployment to the ROS/MuJoCo dog are
being implemented in the later roadmap milestones; they are not available yet.

From the repo root:

1. Run `bash robotics/scripts/sr build` to build the pinned images.
2. Run `bash robotics/scripts/sr precheck` and `bash robotics/scripts/sr test`.
3. Run `bash robotics/scripts/sr up`; wait for broker and mock health checks.
4. Run `bash robotics/scripts/sr pbctl describe` to inspect the SIM connection.
5. Run `bash robotics/scripts/sr pbctl get Robot.Safety.Mode` or
   `bash robotics/scripts/sr pbctl subscribe Robot.Safety.Mode --count 1`.
6. Run `bash robotics/scripts/sr pbctl stop` for a software STOP without a lease.
7. Run `bash robotics/scripts/sr down` to stop these services and retain data.

The mock starts DISARMED. Control CLI examples and private lease-file handling
are in [Protobus tools](../../robotics/protobus/README.md). Each `sr pbctl` call
uses a temporary container; use a single diagnostic container session if reusing
a lease file. Do not publish mock scenario endpoints outside the internal network.
The mock is a synthetic unicycle, not ROS physics or a real robot.

For the complete test status and remaining integration work, read
[M23 progress](../reports/M23-progress.md). No hardware operation is enabled.
