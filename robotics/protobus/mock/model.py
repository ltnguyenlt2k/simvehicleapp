"""Kinematic dog model for the mock provider (pure, tick-driven, deterministic; no I/O).

It mirrors the dog Brain rules that workflows depend on (dog-ros2-simulation brain.py @ 35c45ee):
arm only from DISARMED and ready; motion only in MANUAL with exclusive body ownership and near spawn;
velocity only in MANUAL, clamped to the profile; stop latches SAFE_STOP until ResetStop.
It is NOT physics: it exists for Simulate/Test without ROS (ADR-0066 §5).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from protobus.v1 import protobus_pb2 as pb

LEGS = ("FrontLeft", "FrontRight", "RearLeft", "RearRight")
JOINTS = {"Hip": 0.0, "Thigh": 0.67, "Calf": -1.3}
MOTION_SECONDS = {"CROUCH": 2.0, "BOW": 2.5, "TILT": 2.0, "LIFT_FRONT_LEFT": 2.0, "JUMP": 1.6,
                  "WAVE_FRONT_LEFT": 3.0, "SIT": 2.0, "STAND": 2.0}
RECOVER_SECONDS = 0.5
NAV_SPEED, NAV_TURN, GOAL_TOLERANCE = 0.4, 0.6, 0.15


@dataclass
class Active:
    request_id: str
    path: str
    kind: str  # motion | nav
    name: str = ""
    elapsed: float = 0.0
    phase: str = "RUNNING"
    waypoints: list = field(default_factory=list)


class DogModel:
    def __init__(self, robot_id: str = "dog1", limits: tuple[float, float] = (0.5, 0.65)):
        self.robot_id = robot_id
        self.max_linear, self.max_angular = limits
        self.reset()

    def reset(self) -> None:
        self.time = 0.0
        self.mode, self.reason = "DISARMED", "Ready; arm required"
        self.controller = "NONE"
        self.x = self.y = self.yaw = 0.0
        self.v = self.w = 0.0
        self.cmd = (0.0, 0.0)
        self.soc, self.drain_per_min = 92.0, 0.05
        self.marker_count = 0
        self.min_range = 3.0
        self.scene = "courtyard"
        self.motion_phase, self.motion_name = "IDLE", ""
        self.mission, self.route_done, self.route_total = "IDLE", 0, 0
        self.active: Active | None = None
        self.sitting = False
        self.updates: list[tuple[str, int, str, str]] = []  # (request_id, phase, code, message)
        self.stop_events: list[dict] = []
        self.overrides: dict[str, object] = {}

    # ------------------------------------------------------------ helpers

    @property
    def ready(self) -> bool:
        return self.soc > 3.0

    def _emit(self, request_id: str, phase: int, code: str = "", message: str = "") -> None:
        self.updates.append((request_id, phase, code, message))

    def _transition(self, mode: str, reason: str) -> None:
        if mode == "SAFE_STOP" and self.mode != "SAFE_STOP":
            self.stop_events.append({"Source": "WORKFLOW" if self.controller == "WORKFLOW" else "OPERATOR",
                                     "Reason": reason})
        self.mode, self.reason = mode, reason

    def _end_active(self, phase: int, code: str, message: str) -> None:
        if self.active is None:
            return
        active, self.active = self.active, None
        if active.kind == "motion":
            self.motion_phase = pb.CommandPhase.Name(phase)
        else:
            self.mission = {pb.SUCCEEDED: "SUCCEEDED", pb.CANCELLED: "CANCELLED"}.get(phase, "FAILED")
        self._emit(active.request_id, phase, code, message)

    # ------------------------------------------------------------ inputs

    def set_control(self, active: bool) -> None:
        self.controller = "WORKFLOW" if active else "NONE"

    def setpoint(self, linear: float, angular: float) -> None:
        self.cmd = (max(-self.max_linear, min(self.max_linear, linear)),
                    max(-self.max_angular, min(self.max_angular, angular)))

    def stop(self, reason: str = "Workflow STOP") -> bool:
        self.cmd = (0.0, 0.0)
        self._end_active(pb.CANCELLED, "", "stopped")
        self._transition("SAFE_STOP", reason)
        return True

    def command(self, request_id: str, path: str, args: dict) -> None:
        leaf = path.removeprefix("Robot.")
        reject = lambda why: self._emit(request_id, pb.REJECTED, "", why)
        if leaf == "Safety.Arm":
            if self.mode == "DISARMED" and self.ready and self.active is None:
                self._transition("MANUAL", "Manual ready")
                self._emit(request_id, pb.SUCCEEDED)
            else:
                reject("Disarm/reset stop and wait for healthy sensors before arm")
        elif leaf == "Safety.Disarm":
            self._end_active(pb.CANCELLED, "", "disarmed")
            self.cmd = (0.0, 0.0)
            self._transition("DISARMED", "Operator disarm")
            self._emit(request_id, pb.SUCCEEDED)
        elif leaf == "Safety.ResetStop":
            if self.mode == "SAFE_STOP" and self.ready:
                self._transition("DISARMED", "Stop reset; arm required")
                self._emit(request_id, pb.SUCCEEDED)
            else:
                reject("Reset requires a latched stop")
        elif leaf == "Motion.Perform":
            name = args["Name"]
            if self.mode != "MANUAL" or self.active is not None:
                reject("Motion requires MANUAL, healthy sensors and exclusive body ownership")
            elif math.hypot(self.x, self.y) > 0.6 or self.min_range < 1.0:
                reject("Return within 0.6 m of spawn with 1 m clearance before a named motion")
            elif self.sitting and name not in ("STAND",):
                reject("Stand up before another motion")
            else:
                self.active = Active(request_id, path, "motion", name)
                self.cmd = (0.0, 0.0)
                self.motion_phase, self.motion_name = "RUNNING", name
                self._transition("MOTION", f"Physical {name.lower()} running")
                self._emit(request_id, pb.ACCEPTED)
                self._emit(request_id, pb.RUNNING)
        elif leaf in ("Motion.Cancel", "Navigation.Cancel"):
            if self.active is None and leaf == "Motion.Cancel":
                reject("No active physical motion")
                return
            self._end_active(pb.CANCELLED, "", "cancelled")
            self.cmd = (0.0, 0.0)
            if self.mode in ("MOTION", "AUTO"):
                self._transition("MANUAL", "Cancelled")
            self._emit(request_id, pb.SUCCEEDED)
        elif leaf in ("Navigation.GoTo", "Navigation.FollowRoute"):
            points = [[args["X"], args["Y"]]] if leaf.endswith("GoTo") else [[p["X"], p["Y"]] for p in args["Waypoints"]]
            if self.mode not in ("MANUAL", "AUTO") or self.active is not None:
                reject("Arm first; stop must be reset")
            elif any(abs(px) > 5.65 or abs(py) > 4.65 for px, py in points):
                reject("Goal outside supported odom scene bounds")
            else:
                self.active = Active(request_id, path, "nav", waypoints=points)
                self.mission, self.route_done, self.route_total = "RUNNING", 0, len(points)
                self._transition("AUTO", "Navigating")
                self._emit(request_id, pb.ACCEPTED)
                self._emit(request_id, pb.RUNNING)
        elif leaf == "Simulation.Battery.SetLevel":
            self.soc = float(args["Level"])
            self._emit(request_id, pb.SUCCEEDED)
        else:
            reject(f"mock does not implement {path}")

    def cancel(self, request_id: str) -> None:
        if self.active is not None and self.active.request_id == request_id:
            self._end_active(pb.CANCELLED, "", "cancelled")
            if self.mode in ("MOTION", "AUTO"):
                self._transition("MANUAL", "Cancelled")

    # ------------------------------------------------------------ time

    def tick(self, dt: float) -> None:
        self.time += dt
        self.soc = max(0.0, self.soc - self.drain_per_min * dt / 60)
        active = self.active
        if active is not None and active.kind == "motion":
            active.elapsed += dt
            if active.phase == "RUNNING" and active.elapsed >= MOTION_SECONDS[active.name]:
                active.phase = self.motion_phase = "RECOVERING"
            elif active.phase == "RECOVERING" and active.elapsed >= MOTION_SECONDS[active.name] + RECOVER_SECONDS:
                self.sitting = active.name == "SIT"
                self._end_active(pb.SUCCEEDED, "", "physical motion completed")
                self._transition("MANUAL", "Motion finished")
            self.v = self.w = 0.0
        elif active is not None and active.kind == "nav":
            tx, ty = active.waypoints[0]
            dx, dy = tx - self.x, ty - self.y
            distance = math.hypot(dx, dy)
            if distance <= GOAL_TOLERANCE:
                active.waypoints.pop(0)
                self.route_done += 1
                if not active.waypoints:
                    self.v = self.w = 0.0
                    self._end_active(pb.SUCCEEDED, "", "goal reached")
                    self._transition("MANUAL", "Mission succeeded")
            else:
                heading = math.atan2(dy, dx) - self.yaw
                heading = math.atan2(math.sin(heading), math.cos(heading))
                self.w = max(-NAV_TURN, min(NAV_TURN, 2.0 * heading))
                self.v = NAV_SPEED if abs(heading) < 0.35 else 0.0
        elif self.mode == "MANUAL" and not self.sitting:
            self.v, self.w = self.cmd
        else:
            self.v = self.w = 0.0
        self.yaw = math.atan2(math.sin(self.yaw + self.w * dt), math.cos(self.yaw + self.w * dt))
        self.x += self.v * math.cos(self.yaw) * dt
        self.y += self.v * math.sin(self.yaw) * dt

    # ------------------------------------------------------------ outputs

    def samples(self) -> dict[str, object]:
        motion = self.active is not None and self.active.kind == "motion"
        values: dict[str, object] = {
            "Robot.Identity.Id": self.robot_id, "Robot.Identity.Model": "unitree-go2-sim", "Robot.Identity.Backend": "SIM",
            "Robot.Connection.IsOnline": True, "Robot.Connection.StateAgeMs": 0.0,
            "Robot.Safety.Mode": self.mode, "Robot.Safety.Reason": self.reason, "Robot.Safety.IsReady": self.ready,
            "Robot.Safety.IsArmed": self.mode in ("MANUAL", "AUTO", "MOTION"),
            "Robot.Safety.IsStopLatched": self.mode == "SAFE_STOP", "Robot.Safety.Controller": self.controller,
            "Robot.Pose.Position.X": self.x, "Robot.Pose.Position.Y": self.y, "Robot.Pose.Position.Z": 0.27,
            "Robot.Pose.Orientation.Roll": 0.0, "Robot.Pose.Orientation.Pitch": 0.0, "Robot.Pose.Orientation.Yaw": self.yaw,
            "Robot.Velocity.Linear.X": self.v, "Robot.Velocity.Linear.Y": 0.0, "Robot.Velocity.Angular.Z": self.w,
            "Robot.Velocity.Commanded.LinearX": self.v, "Robot.Velocity.Commanded.AngularZ": self.w,
            "Robot.Imu.AngularVelocity.X": 0.0, "Robot.Imu.AngularVelocity.Y": 0.0, "Robot.Imu.AngularVelocity.Z": self.w,
            "Robot.Imu.LinearAcceleration.X": 0.0, "Robot.Imu.LinearAcceleration.Y": 0.0, "Robot.Imu.LinearAcceleration.Z": 9.81,
            "Robot.Imu.Orientation.Roll": 0.0, "Robot.Imu.Orientation.Pitch": 0.0, "Robot.Imu.Orientation.Yaw": self.yaw,
            "Robot.PowerSystem.Battery.StateOfCharge": round(self.soc, 3),
            "Robot.PowerSystem.Battery.Voltage": round(22.0 + 7.4 * self.soc / 100, 3),
            "Robot.PowerSystem.Battery.IsPresent": True,
            "Robot.Motion.State.Phase": self.motion_phase, "Robot.Motion.State.Name": self.motion_name,
            "Robot.Motion.IsBodyBusy": motion,
            "Robot.Navigation.Mission.State": self.mission, "Robot.Navigation.Route.Completed": self.route_done,
            "Robot.Navigation.Route.Total": self.route_total, "Robot.Navigation.IsReady": True,
            "Robot.Perception.Marker.IsDetected": self.marker_count > 0, "Robot.Perception.Marker.Count": self.marker_count,
            "Robot.Obstacle.MinRange": self.min_range, "Robot.Simulation.SceneId": self.scene,
        }
        lifted = motion and self.active.name in ("LIFT_FRONT_LEFT", "WAVE_FRONT_LEFT") and self.active.phase == "RUNNING"
        for leg in LEGS:
            contact = not (lifted and leg == "FrontLeft") and not (motion and self.active.name == "JUMP"
                                                                    and 0.4 < self.active.elapsed < 0.9)
            values[f"Robot.Leg.{leg}.IsInContact"] = contact
            values[f"Robot.Leg.{leg}.ContactForce"] = 37.0 if contact else 0.0
            for joint, angle in JOINTS.items():
                values[f"Robot.Leg.{leg}.Joint.{joint}.Position"] = angle
                values[f"Robot.Leg.{leg}.Joint.{joint}.Velocity"] = 0.0
                values[f"Robot.Leg.{leg}.Joint.{joint}.Effort"] = 0.0
        values.update(self.overrides)
        return values

    # ------------------------------------------------------------ scenario inputs

    def apply(self, path: str, value) -> None:
        """Scenario stimulus: state-backed paths change the model; others become fixed overrides."""
        if path == "Robot.PowerSystem.Battery.StateOfCharge":
            self.soc = float(value)
        elif path == "Robot.Perception.Marker.IsDetected":
            self.marker_count = 1 if value else 0
        elif path == "Robot.Perception.Marker.Count":
            self.marker_count = int(value)
        elif path == "Robot.Obstacle.MinRange":
            self.min_range = float(value)
        else:
            self.overrides[path] = value
