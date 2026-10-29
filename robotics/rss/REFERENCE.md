# RSS catalog

Hash: sha256:f382fce1b998fb60633fb73f0c4aa5eedb0ac7103734c48253e1be2440cd00a2

| Path | Kind | Type / fields | Unit |
|---|---|---|---|
| Robot.Connection.IsHandshakeComplete | sensor | bool |  |
| Robot.Connection.IsOnline | sensor | bool |  |
| Robot.Connection.LastSampleAgeMs | sensor | float64 | ms |
| Robot.Identity.Backend | attribute | enum |  |
| Robot.Identity.Id | attribute | string |  |
| Robot.Identity.Model | attribute | string |  |
| Robot.Identity.ProfileId | attribute | string |  |
| Robot.Imu.AngularVelocity.X | sensor | float64 | rad/s |
| Robot.Imu.AngularVelocity.Y | sensor | float64 | rad/s |
| Robot.Imu.AngularVelocity.Z | sensor | float64 | rad/s |
| Robot.Imu.LinearAcceleration.X | sensor | float64 | m/s² |
| Robot.Imu.LinearAcceleration.Y | sensor | float64 | m/s² |
| Robot.Imu.LinearAcceleration.Z | sensor | float64 | m/s² |
| Robot.Imu.Orientation.Pitch | sensor | float64 | rad |
| Robot.Imu.Orientation.Roll | sensor | float64 | rad |
| Robot.Imu.Orientation.Yaw | sensor | float64 | rad |
| Robot.Leg.FrontLeft.Foot.ContactForce | sensor | float64 | N |
| Robot.Leg.FrontLeft.Foot.IsInContact | sensor | bool |  |
| Robot.Leg.FrontLeft.Joint.Calf.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontLeft.Joint.Calf.Position | sensor | float64 | rad |
| Robot.Leg.FrontLeft.Joint.Calf.Velocity | sensor | float64 | rad/s |
| Robot.Leg.FrontLeft.Joint.Hip.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontLeft.Joint.Hip.Position | sensor | float64 | rad |
| Robot.Leg.FrontLeft.Joint.Hip.Velocity | sensor | float64 | rad/s |
| Robot.Leg.FrontLeft.Joint.Thigh.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontLeft.Joint.Thigh.Position | sensor | float64 | rad |
| Robot.Leg.FrontLeft.Joint.Thigh.Velocity | sensor | float64 | rad/s |
| Robot.Leg.FrontRight.Foot.ContactForce | sensor | float64 | N |
| Robot.Leg.FrontRight.Foot.IsInContact | sensor | bool |  |
| Robot.Leg.FrontRight.Joint.Calf.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontRight.Joint.Calf.Position | sensor | float64 | rad |
| Robot.Leg.FrontRight.Joint.Calf.Velocity | sensor | float64 | rad/s |
| Robot.Leg.FrontRight.Joint.Hip.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontRight.Joint.Hip.Position | sensor | float64 | rad |
| Robot.Leg.FrontRight.Joint.Hip.Velocity | sensor | float64 | rad/s |
| Robot.Leg.FrontRight.Joint.Thigh.Effort | sensor | float64 | N·m |
| Robot.Leg.FrontRight.Joint.Thigh.Position | sensor | float64 | rad |
| Robot.Leg.FrontRight.Joint.Thigh.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearLeft.Foot.ContactForce | sensor | float64 | N |
| Robot.Leg.RearLeft.Foot.IsInContact | sensor | bool |  |
| Robot.Leg.RearLeft.Joint.Calf.Effort | sensor | float64 | N·m |
| Robot.Leg.RearLeft.Joint.Calf.Position | sensor | float64 | rad |
| Robot.Leg.RearLeft.Joint.Calf.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearLeft.Joint.Hip.Effort | sensor | float64 | N·m |
| Robot.Leg.RearLeft.Joint.Hip.Position | sensor | float64 | rad |
| Robot.Leg.RearLeft.Joint.Hip.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearLeft.Joint.Thigh.Effort | sensor | float64 | N·m |
| Robot.Leg.RearLeft.Joint.Thigh.Position | sensor | float64 | rad |
| Robot.Leg.RearLeft.Joint.Thigh.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearRight.Foot.ContactForce | sensor | float64 | N |
| Robot.Leg.RearRight.Foot.IsInContact | sensor | bool |  |
| Robot.Leg.RearRight.Joint.Calf.Effort | sensor | float64 | N·m |
| Robot.Leg.RearRight.Joint.Calf.Position | sensor | float64 | rad |
| Robot.Leg.RearRight.Joint.Calf.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearRight.Joint.Hip.Effort | sensor | float64 | N·m |
| Robot.Leg.RearRight.Joint.Hip.Position | sensor | float64 | rad |
| Robot.Leg.RearRight.Joint.Hip.Velocity | sensor | float64 | rad/s |
| Robot.Leg.RearRight.Joint.Thigh.Effort | sensor | float64 | N·m |
| Robot.Leg.RearRight.Joint.Thigh.Position | sensor | float64 | rad |
| Robot.Leg.RearRight.Joint.Thigh.Velocity | sensor | float64 | rad/s |
| Robot.Motion.Perform | command | Name |  |
| Robot.Motion.Perform.Status.ExecutionId | sensor | string |  |
| Robot.Motion.Perform.Status.Phase | sensor | enum |  |
| Robot.Motion.Perform.Status.Reason | sensor | string |  |
| Robot.Motion.Velocity | setpoint | LinearX, AngularZ |  |
| Robot.Navigation.FollowRoute | command | RouteId |  |
| Robot.Navigation.FollowRoute.Status.ExecutionId | sensor | string |  |
| Robot.Navigation.FollowRoute.Status.Phase | sensor | enum |  |
| Robot.Navigation.FollowRoute.Status.Reason | sensor | string |  |
| Robot.Navigation.GoTo | command | X, Y |  |
| Robot.Navigation.GoTo.Status.ExecutionId | sensor | string |  |
| Robot.Navigation.GoTo.Status.Phase | sensor | enum |  |
| Robot.Navigation.GoTo.Status.Reason | sensor | string |  |
| Robot.Perception.Marker.Count | sensor | uint32 |  |
| Robot.Perception.Marker.IsDetected | sensor | bool |  |
| Robot.Perception.Obstacle.FrontMinDistance | sensor | float64 | m |
| Robot.Perception.Obstacle.MinDistance | sensor | float64 | m |
| Robot.Pose.Orientation.Pitch | sensor | float64 | rad |
| Robot.Pose.Orientation.Roll | sensor | float64 | rad |
| Robot.Pose.Orientation.Yaw | sensor | float64 | rad |
| Robot.Pose.Position.X | sensor | float64 | m |
| Robot.Pose.Position.Y | sensor | float64 | m |
| Robot.Pose.Position.Z | sensor | float64 | m |
| Robot.PowerSystem.Battery.Current | sensor | float64 | A |
| Robot.PowerSystem.Battery.IsCharging | sensor | bool |  |
| Robot.PowerSystem.Battery.StateOfCharge | sensor | float64 | % |
| Robot.PowerSystem.Battery.Voltage | sensor | float64 | V |
| Robot.Safety.Arm | command |  |  |
| Robot.Safety.Arm.Status.ExecutionId | sensor | string |  |
| Robot.Safety.Arm.Status.Phase | sensor | enum |  |
| Robot.Safety.Arm.Status.Reason | sensor | string |  |
| Robot.Safety.Disarm | command |  |  |
| Robot.Safety.Disarm.Status.ExecutionId | sensor | string |  |
| Robot.Safety.Disarm.Status.Phase | sensor | enum |  |
| Robot.Safety.Disarm.Status.Reason | sensor | string |  |
| Robot.Safety.IsArmed | sensor | bool |  |
| Robot.Safety.IsStopLatched | sensor | bool |  |
| Robot.Safety.Mode | sensor | enum |  |
| Robot.Safety.Reason | sensor | string |  |
| Robot.Safety.ResetStop | command |  |  |
| Robot.Safety.ResetStop.Status.ExecutionId | sensor | string |  |
| Robot.Safety.ResetStop.Status.Phase | sensor | enum |  |
| Robot.Safety.ResetStop.Status.Reason | sensor | string |  |
| Robot.Safety.Stop | command |  |  |
| Robot.Safety.Stop.Status.ExecutionId | sensor | string |  |
| Robot.Safety.Stop.Status.Phase | sensor | enum |  |
| Robot.Safety.Stop.Status.Reason | sensor | string |  |
| Robot.Simulation.IsPaused | sensor | bool |  |
| Robot.Simulation.SceneId | sensor | string |  |
| Robot.Simulation.TimeNs | sensor | int64 |  |
| Robot.Velocity.Angular.Z | sensor | float64 | rad/s |
| Robot.Velocity.Linear.X | sensor | float64 | m/s |
| Robot.Velocity.Linear.Y | sensor | float64 | m/s |
