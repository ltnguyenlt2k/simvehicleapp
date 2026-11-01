"""Generates dog-go2-sim/mapping.json (mapping.v1). Run: python gen_dog_go2_sim.py > dog-go2-sim/mapping.json

Facts from dog-ros2-simulation @ 35c45ee + R4 W1: topics.json, brain.py (brain/state fields, workflow channel),
locomotion.py (joint names {FL,FR,RL,RR}_{hip,thigh,calf}_joint), FootContacts.msg (feet order FL FR RL RR).
"""
import json

LEGS = {"FrontLeft": "FL", "FrontRight": "FR", "RearLeft": "RL", "RearRight": "RR"}
JOINTS = {"Hip": "hip", "Thigh": "thigh", "Calf": "calf"}
s = []


def sensor(path, topic, fn, rate, **args):
    s.append({"path": path, "topic": topic, "fn": fn, "args": args, "maxRateHz": rate})


for axis in "XYZ":
    sensor(f"Robot.Pose.Position.{axis}", "odom", "field", 20, field=f"pose.pose.position.{axis.lower()}")
for name in ("Roll", "Pitch", "Yaw"):
    sensor(f"Robot.Pose.Orientation.{name}", "odom", "quat", 20, field="pose.pose.orientation", axis=name.lower())
    sensor(f"Robot.Imu.Orientation.{name}", "imu/data", "quat", 20, field="orientation", axis=name.lower())
sensor("Robot.Velocity.Linear.X", "odom", "field", 20, field="twist.twist.linear.x")
sensor("Robot.Velocity.Linear.Y", "odom", "field", 20, field="twist.twist.linear.y")
sensor("Robot.Velocity.Angular.Z", "odom", "field", 20, field="twist.twist.angular.z")
sensor("Robot.Velocity.Commanded.LinearX", "cmd_vel/safe", "field", 10, field="twist.linear.x")
sensor("Robot.Velocity.Commanded.AngularZ", "cmd_vel/safe", "field", 10, field="twist.angular.z")
for axis in "XYZ":
    sensor(f"Robot.Imu.AngularVelocity.{axis}", "imu/data", "field", 20, field=f"angular_velocity.{axis.lower()}")
    sensor(f"Robot.Imu.LinearAcceleration.{axis}", "imu/data", "field", 20, field=f"linear_acceleration.{axis.lower()}")
for index, (leg, short) in enumerate(LEGS.items()):
    sensor(f"Robot.Leg.{leg}.IsInContact", "foot_contacts", "array_index", 20, field="contact", index=index, expect_name=short)
    sensor(f"Robot.Leg.{leg}.ContactForce", "foot_contacts", "array_index", 20, field="normal_force_n", index=index, expect_name=short)
    for joint, j in JOINTS.items():
        for attr, key in (("Position", "position"), ("Velocity", "velocity"), ("Effort", "effort")):
            sensor(f"Robot.Leg.{leg}.Joint.{joint}.{attr}", "joint_states", "joint", 10, name=f"{short}_{j}_joint", attr=key)
sensor("Robot.PowerSystem.Battery.StateOfCharge", "battery_state", "field", 1, field="percentage", scale=100.0)
sensor("Robot.PowerSystem.Battery.Voltage", "battery_state", "field", 1, field="voltage")
sensor("Robot.PowerSystem.Battery.IsPresent", "battery_state", "field", 1, field="present")
BS = "brain/state"
sensor("Robot.Safety.Mode", BS, "json_field", 10, field="mode")
sensor("Robot.Safety.Reason", BS, "json_field", 10, field="reason")
sensor("Robot.Safety.IsReady", BS, "json_field", 10, field="ready")
sensor("Robot.Safety.IsArmed", BS, "json_in", 10, field="mode", values=["MANUAL", "AUTO", "MOTION"])
sensor("Robot.Safety.IsStopLatched", BS, "json_in", 10, field="mode", values=["SAFE_STOP"])
sensor("Robot.Safety.Controller", BS, "json_field", 10, field="controller", default="NONE")
sensor("Robot.Motion.State.Phase", BS, "json_field", 10, field="motion.phase", default="IDLE")
sensor("Robot.Motion.State.Name", BS, "json_field", 10, field="motion.name", default="", map={"crouch": "CROUCH", "bow": "BOW", "tilt": "TILT", "lift_fl": "LIFT_FRONT_LEFT", "jump": "JUMP", "wave_fl": "WAVE_FRONT_LEFT", "sit": "SIT", "stand": "STAND"})
sensor("Robot.Motion.IsBodyBusy", BS, "json_not_null", 10, field="active_motion_id")
sensor("Robot.Navigation.Mission.State", BS, "json_field", 10, field="mission")
sensor("Robot.Navigation.Route.Completed", BS, "json_field", 10, field="route_completed")
sensor("Robot.Navigation.Route.Total", BS, "json_field", 10, field="route_total")
sensor("Robot.Navigation.IsReady", BS, "json_field", 10, field="nav_ready")
sensor("Robot.Simulation.SceneId", BS, "json_field", 10, field="scene_id")
sensor("Robot.Connection.IsOnline", BS, "fresh", 5, within_ms=1000)
sensor("Robot.Connection.StateAgeMs", BS, "age_ms", 5)
sensor("Robot.Perception.Marker.IsDetected", "perception/detections", "count_class", 10, class_id="red_sim_marker", as_bool=True)
sensor("Robot.Perception.Marker.Count", "perception/detections", "count_class", 10, class_id="red_sim_marker")
sensor("Robot.Obstacle.MinRange", "scan", "min_finite", 10, field="ranges")

MOTIONS = {"CROUCH": "crouch", "BOW": "bow", "TILT": "tilt", "LIFT_FRONT_LEFT": "lift_fl", "JUMP": "jump",
           "WAVE_FRONT_LEFT": "wave_fl", "SIT": "sit", "STAND": "stand"}
mapping = {
    "schema": "mapping.v1",
    "profile": "dog-go2-sim",
    "rosNamespace": "/dog1",
    "sourceCommit": "7bdbcbc1961c3a6a148a953abc02e67b6506ae1c",
    "requires": "dog-ros2-simulation R4 W1 (workflow/request, brain/state.controller)",
    "envelope": {"requestTopic": "workflow/request", "ackTopic": "workflow/ack", "schema": 1, "leaseTtlMs": 1000,
                 "renewMs": 300, "clockTopic": "/clock", "configHashFrom": "brain/state"},
    "topics": {
        "odom": {"type": "nav_msgs/msg/Odometry", "reliability": "reliable", "depth": 5},
        "imu/data": {"type": "sensor_msgs/msg/Imu", "reliability": "best_effort", "depth": 2},
        "joint_states": {"type": "sensor_msgs/msg/JointState", "reliability": "best_effort", "depth": 2},
        "foot_contacts": {"type": "dog_interfaces/msg/FootContacts", "reliability": "best_effort", "depth": 2},
        "battery_state": {"type": "sensor_msgs/msg/BatteryState", "reliability": "reliable", "depth": 1},
        "brain/state": {"type": "std_msgs/msg/String", "reliability": "reliable", "depth": 5},
        "cmd_vel/safe": {"type": "geometry_msgs/msg/TwistStamped", "reliability": "reliable", "depth": 1},
        "perception/detections": {"type": "vision_msgs/msg/Detection2DArray", "reliability": "best_effort", "depth": 2},
        "scan": {"type": "sensor_msgs/msg/LaserScan", "reliability": "best_effort", "depth": 2},
    },
    "sensors": s,
    "commands": {
        "Robot.Safety.Arm": {"request": {"action": "arm"}, "result": {"kind": "mode", "success": ["MANUAL"]}},
        "Robot.Safety.Disarm": {"request": {"action": "disarm"}, "result": {"kind": "mode", "success": ["DISARMED"]}},
        "Robot.Safety.ResetStop": {"request": {"action": "reset_stop"}, "result": {"kind": "mode", "success": ["DISARMED"]}},
        "Robot.Motion.Perform": {"request": {"action": "motion", "motion_name": "$Name"}, "argMap": {"Name": MOTIONS},
                                 "result": {"kind": "motion"}},
        "Robot.Motion.Cancel": {"request": {"action": "motion_cancel"}, "result": {"kind": "ack"}},
        "Robot.Navigation.GoTo": {"request": {"action": "goal", "goal": ["$X", "$Y"], "goal_frame": "map"},
                                  "result": {"kind": "mission"}},
        "Robot.Navigation.FollowRoute": {"request": {"action": "route", "waypoints": "$Waypoints[X,Y]", "goal_frame": "map"},
                                         "result": {"kind": "mission"}},
        "Robot.Navigation.Cancel": {"request": {"action": "cancel"}, "result": {"kind": "ack"}},
    },
    "setpoints": {"Robot.Motion.Velocity": {"request": {"action": "manual", "linear": "$LinearX", "angular": "$AngularZ"}}},
    "stop": {"request": {"action": "stop"}, "confirm": {"field": "mode", "equals": "SAFE_STOP", "withinMs": 800}},
}
print(json.dumps(mapping, indent=1, sort_keys=False))
