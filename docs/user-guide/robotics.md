# Robotics development preview

The independent robotics stack provides RSS contracts, Protobus, a synthetic
mock provider and a development adapter to the ROS/MuJoCo dog. Robot Studio and
workflow deployment are still being implemented.

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

## Live dog simulation preview

Start the separate dog simulation first (domain 52, Docker network
`dog-ros2-r1_robot`). Then run from this repo root:

1. `bash robotics/scripts/sr build --live`
2. `bash robotics/scripts/sr precheck`
3. `bash robotics/scripts/sr up --live`
4. `bash robotics/scripts/sr pbctl --live describe`
5. `bash robotics/scripts/sr pbctl --live get Robot.Safety.Mode`
6. `bash robotics/scripts/sr pbctl --live stop`

Set `SR_ROBOT_NETWORK` if the external Docker network has a different name.
The live broker has its own network and audit volume. `sr up --live` waits up to
60 seconds for healthy broker/provider services. The adapter only publishes
robot requests through the Brain's control interface. Startup does not Arm;
tracked defaults reject remote Arm. An explicitly authorized local SIM session
can opt in with `SR_AUTHORIZE_SIM_ARM=true bash robotics/scripts/sr up --live`.
This permits a later explicit Arm command; it does not start robot motion.
After STOP or connection loss, explicitly recover and acquire fresh authority.
Never reuse old lease files as recovery. `sr down` stops this robotics stack and
preserves its volumes. See [M24 progress](../reports/M24-progress.md) for the open
workflow/compiler/UI/video gates; M24 transport/fault/equality/30-minute gates
have passed. Software STOP is not a physical E-stop.


RobotFlow runtime developer preview: [installed wheel and CLI checks](../../robotics/rfrt/README.md). Native generated Python now verifies artifacts and the actual runtime pin before loading. Hold and Cancel prerequisites passed actual ROS/physics checks; installed runtime local tests pass. Full generated workflow deployment UI and continuous video remain under M25–M27 implementation, not released functionality.
