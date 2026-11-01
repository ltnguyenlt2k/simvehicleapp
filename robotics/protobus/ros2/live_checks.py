"""M24 live checks against the real dog simulation (run in the bridge image, on the dog + bus-ros networks).

Reads ROS topics with its own code (not protobus.ros2.transforms) and compares with Protobus values; drives the
robot only through the broker like a workflow app would. Prints one JSON report.

    python3 -m protobus.ros2.live_checks --broker protobus-broker-ros:55500 --safety protobus-broker-ros:55501
"""
from __future__ import annotations

import argparse
import asyncio
import http.client
import json
import math
import threading
import time
import uuid

import grpc
import rclpy
from dog_interfaces.msg import FootContacts
from nav_msgs.msg import Odometry
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import BatteryState, Imu, JointState, LaserScan
from std_msgs.msg import String

from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.wire import from_value, to_struct


class RosView:
    def __init__(self):
        rclpy.init()
        self.node = rclpy.create_node("protobus_live_probe")
        self.latest: dict[str, object] = {}
        for topic, kind, qos in [("odom", Odometry, 5), ("imu/data", Imu, qos_profile_sensor_data),
                                 ("joint_states", JointState, qos_profile_sensor_data),
                                 ("foot_contacts", FootContacts, qos_profile_sensor_data),
                                 ("battery_state", BatteryState, 1), ("scan", LaserScan, qos_profile_sensor_data),
                                 ("brain/state", String, 5)]:
            self.node.create_subscription(kind, "/dog1/" + topic, lambda m, t=topic: self.latest.__setitem__(t, m), qos)
        self.executor = SingleThreadedExecutor()
        self.executor.add_node(self.node)
        self.thread = threading.Thread(target=self.executor.spin, daemon=True)
        self.thread.start()

    def close(self):
        self.executor.shutdown()
        self.thread.join(2)
        self.node.destroy_node()
        rclpy.shutdown()

    def brain(self) -> dict:
        msg = self.latest.get("brain/state")
        return json.loads(msg.data) if msg else {}

    def expected(self) -> dict[str, tuple[float, float]]:
        """Independent ROS readings → (value, tolerance)."""
        out: dict[str, tuple[float, float]] = {}
        odom = self.latest["odom"]
        p, tw = odom.pose.pose.position, odom.twist.twist
        out |= {"Robot.Pose.Position.X": (p.x, 0.02), "Robot.Pose.Position.Y": (p.y, 0.02), "Robot.Pose.Position.Z": (p.z, 0.02),
                "Robot.Velocity.Linear.X": (tw.linear.x, 0.05), "Robot.Velocity.Angular.Z": (tw.angular.z, 0.05)}
        q = odom.pose.pose.orientation
        out["Robot.Pose.Orientation.Yaw"] = (math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y ** 2 + q.z ** 2)), 0.02)
        imu = self.latest["imu/data"]
        for axis in "xyz":
            out[f"Robot.Imu.AngularVelocity.{axis.upper()}"] = (getattr(imu.angular_velocity, axis), 0.1)
            out[f"Robot.Imu.LinearAcceleration.{axis.upper()}"] = (getattr(imu.linear_acceleration, axis), 0.6)
        joints = self.latest["joint_states"]
        legs = {"FL": "FrontLeft", "FR": "FrontRight", "RL": "RearLeft", "RR": "RearRight"}
        for name, value in zip(joints.name, joints.position):
            leg, joint, _ = name.split("_")
            out[f"Robot.Leg.{legs[leg]}.Joint.{joint.capitalize()}.Position"] = (value, 0.05)
        feet = self.latest["foot_contacts"]
        for index, short in enumerate(feet.feet):
            out[f"Robot.Leg.{legs[short]}.ContactForce"] = (feet.normal_force_n[index], 6.0)
            out[f"Robot.Leg.{legs[short]}.IsInContact"] = (float(feet.contact[index]), 0.0)
        battery = self.latest["battery_state"]
        out["Robot.PowerSystem.Battery.StateOfCharge"] = (battery.percentage * 100, 0.01)
        out["Robot.PowerSystem.Battery.Voltage"] = (battery.voltage, 0.01)
        scan = self.latest["scan"]
        finite = [r for r in scan.ranges if math.isfinite(r) and scan.range_min <= r <= scan.range_max]
        out["Robot.Obstacle.MinRange"] = (min(finite), 0.15)
        return out


def gateway(path: str, body: dict) -> dict:
    connection = http.client.HTTPConnection("gateway", 8090, timeout=10)
    connection.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
    return json.loads(connection.getresponse().read())


def gateway_control(action: str, **fields) -> dict:
    return gateway("/api/control", {"action": action, **fields})


async def prepare(ros: "RosView") -> dict:
    """Test fixture through the operator HMI (like the dog's own tests): healthy, DISARMED robot at spawn."""
    gateway_control("disarm")
    await asyncio.sleep(1.0)
    brain = ros.brain()
    position = ros.latest["odom"].pose.pose.position
    reset = not brain.get("ready") or brain.get("mode") == "SAFE_STOP" or math.hypot(position.x, position.y) > 0.3
    if reset:
        gateway("/api/sim", {"action": "reset"})
        await until(lambda: ros.brain().get("ready") and ros.brain().get("nav_ready"), 90, 0.2)
        gateway_control("reset_stop")
        await until(lambda: ros.brain().get("mode") == "DISARMED", 10)
    await asyncio.sleep(2.0)
    return {"worldReset": reset, "mode": ros.brain().get("mode"), "ready": ros.brain().get("ready")}


class App:
    """Drives the robot through Protobus exactly as a generated workflow app would."""

    def __init__(self, broker: rpc.BrokerStub, safety: rpc.SafetyLaneStub):
        self.broker, self.safety = broker, safety
        self.lease: pb.Lease | None = None
        self.renewer: asyncio.Task | None = None

    async def acquire(self):
        self.lease = await self.broker.AcquireControl(pb.AcquireRequest(client_id="m24-live-checks"))

        async def renew():
            while True:
                await asyncio.sleep(0.3)
                try:
                    await self.broker.RenewControl(self.lease)
                except grpc.aio.AioRpcError:
                    return
        self.renewer = asyncio.ensure_future(renew())

    async def release(self):
        if self.renewer:
            self.renewer.cancel()
        if self.lease:
            await self.broker.ReleaseControl(self.lease)
        self.lease = None

    async def run(self, path: str, args: dict | None = None) -> list[str]:
        request = pb.CommandRequest(lease_id=self.lease.lease_id, path=path, args=to_struct(args or {}),
                                    request_id=str(uuid.uuid4()))
        return [f"{pb.CommandPhase.Name(u.phase)}:{u.message}" async for u in self.broker.Execute(request)]

    async def values(self, paths: list[str]) -> dict:
        response = await self.broker.Get(pb.GetRequest(paths=paths))
        return {s.path: (from_value(s.value), s.quality) for s in response.samples}


async def until(predicate, timeout: float, step: float = 0.02) -> float | None:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if predicate():
            return time.monotonic() - start
        await asyncio.sleep(step)
    return None


async def main_async(args) -> dict:
    ros = RosView()
    report: dict = {}
    await until(lambda: all(k in ros.latest for k in ("odom", "imu/data", "joint_states", "foot_contacts",
                                                     "battery_state", "scan", "brain/state")), 15)
    async with grpc.aio.insecure_channel(args.broker) as channel, grpc.aio.insecure_channel(args.safety) as safety_channel:
        app = App(rpc.BrokerStub(channel), rpc.SafetyLaneStub(safety_channel))
        report["prepare"] = await prepare(ros)

        # 1. value equality while standing still (DISARMED)
        expected = ros.expected()
        got = await app.values(sorted(expected))
        mismatches = []
        for path, (value, tolerance) in expected.items():
            actual, quality = got[path]
            actual = float(actual) if isinstance(actual, (bool, int, float)) else actual
            if quality != pb.OK or actual is None or abs(actual - value) > tolerance:
                mismatches.append({"path": path, "ros": value, "protobus": actual, "quality": pb.Quality.Name(quality)})
        report["equality"] = {"paths": len(expected), "mismatches": mismatches}

        # 2. stop latency (workflow armed, stop through the safety lane, robot-confirmed)
        latencies = []
        for _ in range(args.stops):
            await app.acquire()
            arm = await app.run("Robot.Safety.Arm")
            assert arm[-1].startswith("SUCCEEDED"), arm
            started = time.perf_counter()
            result = await app.safety.Stop(pb.StopRequest(request_id=str(uuid.uuid4()), source="WORKFLOW", reason="m24"))
            latencies.append((time.perf_counter() - started) * 1000)
            assert result.confirmed and ros.brain().get("mode") == "SAFE_STOP", result
            await app.release()
            await app.acquire()
            reset = await app.run("Robot.Safety.ResetStop")
            assert reset[-1].startswith("SUCCEEDED"), reset
            await app.release()
            await until(lambda: ros.brain().get("controller") == "NONE", 3)
        latencies.sort()
        report["stopLatencyMs"] = {"n": len(latencies), "p50": round(latencies[len(latencies) // 2], 1),
                                   "p95": round(latencies[int(len(latencies) * 0.95) - 1], 1), "max": round(latencies[-1], 1)}

        # 3. named motions from the qualified spawn pose (dog guards: courtyard, ≤ 0.6 m, ≥ 1 m clearance)
        await app.acquire()
        await app.run("Robot.Safety.Arm")
        report["motion"] = {name: await app.run("Robot.Motion.Perform", {"Name": name}) for name in ("BOW", "JUMP", "LIFT_FRONT_LEFT")}

        # 4. velocity setpoint at 20 Hz, then silence → TTL safe value + Brain watchdog
        start = ros.latest["odom"].pose.pose.position
        for _ in range(40):
            ack = await app.broker.SetSetpoint(pb.SetpointRequest(lease_id=app.lease.lease_id, path="Robot.Motion.Velocity",
                                                                  fields={"LinearX": 0.3, "AngularZ": 0.0}))
            assert ack.accepted, ack
            await asyncio.sleep(0.05)
        end = ros.latest["odom"].pose.pose.position
        moved = math.hypot(end.x - start.x, end.y - start.y)
        stopped_in = await until(lambda: ros.brain().get("safe_command") == [0.0, 0.0], 2.0, 0.005)
        report["velocity"] = {"commandedS": 2.0, "movedM": round(moved, 3), "safeCommandZeroAfterS": round(stopped_in or -1, 3)}

        # 5. navigation in the map frame (Nav2 + SLAM of the dog)
        goto = await app.run("Robot.Navigation.GoTo", {"X": 1.0, "Y": 0.0})
        route = await app.run("Robot.Navigation.FollowRoute", {"Waypoints": [{"X": 0.6, "Y": 0.3}, {"X": 0.2, "Y": 0.0}]})
        report["navigation"] = {"goto": goto, "route": route, "routeCompleted": ros.brain().get("route_completed"),
                                "routeTotal": ros.brain().get("route_total"), "modeAfter": ros.brain().get("mode")}

        # 6. operator takeover revokes the workflow
        for _ in range(5):
            await app.broker.SetSetpoint(pb.SetpointRequest(lease_id=app.lease.lease_id, path="Robot.Motion.Velocity",
                                                            fields={"LinearX": 0.0, "AngularZ": 0.2}))
            await asyncio.sleep(0.05)
        operator = gateway_control("manual", linear=0.0, angular=0.0)
        revoked = await until(lambda: ros.brain().get("controller") == "OPERATOR", 2)
        refused = await app.run("Robot.Motion.Perform", {"Name": "BOW"})
        controller = await app.values(["Robot.Safety.Controller"])
        report["operatorTakeover"] = {"operatorAccepted": operator.get("accepted"), "revokedAfterS": revoked,
                                      "workflowCommandAfterTakeover": refused,
                                      "rssController": controller["Robot.Safety.Controller"][0]}
        await app.release()
        gateway_control("disarm")
    ros.close()
    report["passed"] = (not report["equality"]["mismatches"] and report["stopLatencyMs"]["p95"] < 500
                        and report["velocity"]["movedM"] > 0.3 and 0 <= report["velocity"]["safeCommandZeroAfterS"] <= 0.6
                        and report["navigation"]["goto"][-1].startswith("SUCCEEDED")
                        and report["navigation"]["route"][-1].startswith("SUCCEEDED")
                        and any(x.startswith("RUNNING") for x in report["navigation"]["route"])
                        and report["navigation"]["routeCompleted"] == report["navigation"]["routeTotal"] == 2
                        and all(v[-1].startswith("SUCCEEDED") for v in report["motion"].values())
                        and report["operatorTakeover"]["revokedAfterS"] is not None
                        and report["operatorTakeover"]["workflowCommandAfterTakeover"][-1].startswith("REJECTED"))
    return report


async def stream_async(args) -> dict:
    """Fault fixture: arm and stream a forward velocity until the broker/bridge disappears."""
    ros = RosView()
    await until(lambda: "brain/state" in ros.latest and "odom" in ros.latest, 15)
    prepared = await prepare(ros)
    sent, error = 0, None
    async with grpc.aio.insecure_channel(args.broker) as channel, grpc.aio.insecure_channel(args.safety) as safety_channel:
        app = App(rpc.BrokerStub(channel), rpc.SafetyLaneStub(safety_channel))
        await app.acquire()
        await app.run("Robot.Safety.Arm")
        print(json.dumps({"streaming": True, "t": time.time()}), flush=True)
        end = time.monotonic() + args.stream
        try:
            while time.monotonic() < end:
                await app.broker.SetSetpoint(pb.SetpointRequest(lease_id=app.lease.lease_id, path="Robot.Motion.Velocity",
                                                                fields={"LinearX": 0.25, "AngularZ": 0.0}), timeout=0.5)
                sent += 1
                await asyncio.sleep(0.05)
        except grpc.aio.AioRpcError as failure:
            error = failure.code().name
    ros.close()
    return {"prepare": prepared, "setpointsSent": sent, "streamError": error}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stream", type=float, default=0)
    parser.add_argument("--broker", default="protobus-broker-ros:55500")
    parser.add_argument("--safety", default="protobus-broker-ros:55501")
    parser.add_argument("--stops", type=int, default=20)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(stream_async(args) if args.stream else main_async(args)), indent=1))


if __name__ == "__main__":
    main()
