"""protobus-ros2: Protobus provider that maps RSS ↔ ROS 2 for one robot profile (ADR-0066 §4, ADR-0069).

- Telemetry: subscribes the mapping's topics, applies closed transforms, rate-limits per path (latest-wins).
- Control: only high-level requests on <ns>/workflow/request with the schema-1 envelope (request_id kept end
  to end, issued_at_ns from /clock, config_hash learnt from the robot). Never cmd_vel, motion/request or motors.
- Results: from measured robot state (brain/state motion/mission/mode), never from the ack alone.
Runs on the ROS 2 Humble system Python (3.10). rclpy spins in a thread; gRPC runs on the asyncio loop.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import logging
import os
import threading
import time
import uuid

import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import QoSProfile, ReliabilityPolicy
from rosgraph_msgs.msg import Clock
from std_msgs.msg import String

from protobus.catalog import Catalog
from protobus.provider_client import ProviderClient
from protobus.ros2 import transforms
from protobus.v1 import protobus_pb2 as pb

log = logging.getLogger("protobus.ros2")
MOTION_TERMINAL = {"SUCCEEDED": pb.SUCCEEDED, "CANCELLED": pb.CANCELLED, "FAILED": pb.FAILED, "REJECTED": pb.REJECTED}
MISSION_TERMINAL = {"SUCCEEDED": pb.SUCCEEDED, "CANCELLED": pb.CANCELLED, "FAILED": pb.FAILED, "REJECTED": pb.REJECTED}


def message_type(name: str):
    package, _, cls = name.split("/")
    return getattr(importlib.import_module(f"{package}.msg"), cls)


class Bridge:
    def __init__(self, mapping: dict, catalog: Catalog, broker: str, safety: str):
        self.mapping, self.catalog = mapping, catalog
        self.ns = mapping["rosNamespace"]
        self.loop: asyncio.AbstractEventLoop | None = None
        self.sim_ns = 0
        self.config_hash: str | None = None
        self.brain: dict = {}
        self.brain_received = 0.0
        self.brain_changed: asyncio.Condition | None = None
        self.acks: dict[str, asyncio.Future] = {}
        self.lease_id: str | None = None
        self.lease_task: asyncio.Task | None = None
        self.last_sent: dict[str, float] = {}
        self.stats = {"messages": 0, "samples": 0, "requests": 0}
        owned = [s["path"] for s in mapping["sensors"] if s["path"] in catalog.nodes]
        owned += [p for p in list(mapping["commands"]) + list(mapping["setpoints"]) if p in catalog.nodes]
        owned.append("Robot.Safety.Stop")
        attributes = [p for p, n in catalog.nodes.items() if n["kind"] == "attribute" and "value" in n]
        self.attributes = {p: catalog.nodes[p]["value"] for p in attributes}
        self.client = ProviderClient(broker, safety, "ros2-" + mapping["profile"], catalog.hash,
                                     sorted(set(owned + attributes)), self)
        self.by_topic: dict[str, list[dict]] = {}
        for sensor in mapping["sensors"]:
            self.by_topic.setdefault(sensor["topic"], []).append(sensor)

    # ------------------------------------------------------------ ROS side (rclpy thread)

    def start_ros(self) -> None:
        rclpy.init()
        self.node = rclpy.create_node("protobus_ros2")
        envelope = self.mapping["envelope"]
        self.request_pub = self.node.create_publisher(String, f"{self.ns}/{envelope['requestTopic']}", 5)
        self.node.create_subscription(String, f"{self.ns}/{envelope['ackTopic']}", self._on_ack, 5)
        self.node.create_subscription(Clock, envelope["clockTopic"], self._on_clock, 5)
        for topic, sensors in self.by_topic.items():
            spec = self.mapping["topics"][topic]
            qos = QoSProfile(depth=spec["depth"], reliability=ReliabilityPolicy.RELIABLE
                             if spec["reliability"] == "reliable" else ReliabilityPolicy.BEST_EFFORT)
            callback = self._on_json if spec["type"] == "std_msgs/msg/String" else self._on_message
            self.node.create_subscription(message_type(spec["type"]), f"{self.ns}/{topic}",
                                          lambda msg, t=topic, cb=callback: cb(t, msg), qos)
        self.executor = SingleThreadedExecutor()
        self.executor.add_node(self.node)
        threading.Thread(target=self.executor.spin, name="rclpy", daemon=True).start()

    def _on_clock(self, msg) -> None:
        self.sim_ns = msg.clock.sec * 1_000_000_000 + msg.clock.nanosec

    def _on_ack(self, msg) -> None:
        data = json.loads(msg.data)
        future = self.acks.get(data.get("request_id"))
        if future is not None and self.loop is not None:
            self.loop.call_soon_threadsafe(lambda: future.done() or future.set_result(data))

    def _on_json(self, topic: str, msg) -> None:
        data = json.loads(msg.data)
        if topic == "brain/state":
            self.config_hash = data.get("config_hash", self.config_hash)
            self.brain = data
            self.brain_received = time.monotonic()
            if self.loop is not None:
                self.loop.call_soon_threadsafe(self._notify_brain)
        self._emit(topic, data, data.get("issued_at_ns", 0))

    def _on_message(self, topic: str, msg) -> None:
        stamp = getattr(getattr(msg, "header", None), "stamp", None)
        capture = stamp.sec * 1_000_000_000 + stamp.nanosec if stamp is not None else 0
        self._emit(topic, msg, capture)

    def _emit(self, topic: str, msg, capture_ns: int) -> None:
        self.stats["messages"] += 1
        now = time.monotonic()
        values = {}
        for sensor in self.by_topic[topic]:
            path = sensor["path"]
            if sensor["fn"] in transforms.DERIVED or now - self.last_sent.get(path, 0.0) < 1.0 / sensor["maxRateHz"]:
                continue
            value = transforms.TRANSFORMS[sensor["fn"]](msg, **sensor["args"])
            if value is None:
                continue
            values[path] = value
            self.last_sent[path] = now
        if values and self.loop is not None:
            self.stats["samples"] += len(values)
            self.loop.call_soon_threadsafe(self.client.publish, values, capture_ns)

    def publish_request(self, payload: dict) -> None:
        if self.config_hash is None:
            raise RuntimeError("robot config_hash not learnt yet (no brain/state)")
        envelope = {"schema": self.mapping["envelope"]["schema"], "config_hash": self.config_hash,
                    "issued_at_ns": self.sim_ns, "controller": "workflow", **payload}
        self.stats["requests"] += 1
        self.request_pub.publish(String(data=json.dumps(envelope)))

    # ------------------------------------------------------------ asyncio side

    def _notify_brain(self) -> None:
        if self.lease_id is not None and self.brain.get("controller_lease_id") not in (None, self.lease_id) \
                or (self.lease_id is not None and self.brain.get("controller") == "OPERATOR"):
            log.warning("robot revoked workflow control: %s", self.brain.get("controller_reason"))
            self.lease_id = None  # the operator won; commands are refused until a new Protobus lease
            if self.lease_task:
                self.lease_task.cancel()

        async def notify():
            async with self.brain_changed:
                self.brain_changed.notify_all()
        asyncio.ensure_future(notify())

    async def wait_brain(self, predicate, timeout: float) -> bool:
        end = time.monotonic() + timeout
        async with self.brain_changed:
            while not predicate(self.brain):
                remaining = end - time.monotonic()
                if remaining <= 0:
                    return False
                try:
                    await asyncio.wait_for(self.brain_changed.wait(), remaining)
                except asyncio.TimeoutError:
                    return predicate(self.brain)
        return True

    async def request(self, payload: dict, timeout: float = 2.0) -> dict:
        request_id = payload.setdefault("request_id", str(uuid.uuid4()))
        future = asyncio.get_running_loop().create_future()
        self.acks[request_id] = future
        try:
            self.publish_request(payload)
            return await asyncio.wait_for(future, timeout)
        except (asyncio.TimeoutError, RuntimeError) as error:
            return {"request_id": request_id, "accepted": False, "reason": f"no robot ack: {error or 'timeout'}"}
        finally:
            self.acks.pop(request_id, None)

    async def on_control(self, active: bool, lease_id: str) -> None:
        if active and self.lease_id is None:
            self.lease_id = str(uuid.uuid4())
            ack = await self.request({"action": "acquire", "lease_id": self.lease_id,
                                      "lease_ttl_ms": self.mapping["envelope"]["leaseTtlMs"]})
            if not ack.get("accepted"):
                log.warning("robot refused workflow control: %s", ack.get("reason"))
                self.lease_id = None
                return
            self.lease_task = asyncio.ensure_future(self._renew())
        elif not active and self.lease_id is not None:
            if self.lease_task:
                self.lease_task.cancel()
            lease, self.lease_id = self.lease_id, None
            await self.request({"action": "release", "lease_id": lease})

    async def _renew(self) -> None:
        while self.lease_id is not None:
            await asyncio.sleep(self.mapping["envelope"]["renewMs"] / 1000)
            if self.lease_id is not None:
                try:
                    self.publish_request({"action": "renew", "lease_id": self.lease_id, "request_id": str(uuid.uuid4())})
                except RuntimeError:
                    pass

    async def _ensure_lease(self) -> str | None:
        for _ in range(20):
            if self.lease_id is not None:
                return self.lease_id
            await asyncio.sleep(0.05)
        return None

    async def on_command(self, request_id: str, path: str, args: dict, timeout_ms: int) -> None:
        spec = self.mapping["commands"].get(path)
        update = self.client.command_update
        if spec is None:
            update(request_id, pb.REJECTED, "", f"{path} is not mapped for this robot")
            return
        lease = await self._ensure_lease()
        if lease is None:
            update(request_id, pb.REJECTED, "", "robot did not grant workflow control (operator may hold it)")
            return
        try:
            body = transforms.substitute(spec["request"], args, spec.get("argMap"))
        except KeyError as error:
            update(request_id, pb.REJECTED, "", f"argument not supported by this robot: {error}")
            return
        ack = await self.request({**body, "request_id": request_id, "lease_id": lease})
        if not ack.get("accepted"):
            update(request_id, pb.REJECTED, "", ack.get("reason", "rejected by robot"))
            return
        update(request_id, pb.ACCEPTED, "", ack.get("reason", ""))
        result = spec["result"]
        deadline = timeout_ms / 1000
        if result["kind"] == "ack":
            update(request_id, pb.SUCCEEDED, "", "acknowledged by robot")
        elif result["kind"] == "mode":
            ok = await self.wait_brain(lambda b: b.get("mode") in result["success"], deadline)
            update(request_id, pb.SUCCEEDED if ok else pb.FAILED, "", f"robot mode {self.brain.get('mode')}")
        elif result["kind"] == "motion":
            await self._follow(request_id, deadline, lambda b: (b.get("motion") or {}) if
                               (b.get("motion") or {}).get("motion_id") == request_id else None,
                               "phase", MOTION_TERMINAL)
        elif result["kind"] == "mission":
            # Brain missions carry no id: a terminal state left by an earlier mission must never be taken as
            # this command's result. Only a RUNNING observed after this ack starts the correlation.
            started = await self.wait_brain(lambda b: b.get("mission") == "RUNNING", 5)
            if not started:
                update(request_id, pb.FAILED, "", f"navigation did not start (mission {self.brain.get('mission')})")
                return
            await self._follow(request_id, deadline, lambda b: {"phase": b.get("mission")}, "phase", MISSION_TERMINAL)

    async def _follow(self, request_id, deadline, view, key, terminal) -> None:
        running_sent = False
        end = time.monotonic() + deadline

        def state():
            current = view(self.brain)
            return current.get(key) if current else None

        while time.monotonic() < end:
            phase = state()
            if phase in ("RUNNING", "RECOVERING") and not running_sent:
                self.client.command_update(request_id, pb.RUNNING, "", phase.lower())
                running_sent = True
            if phase in terminal:
                detail = (view(self.brain) or {}).get("reason") or ""
                self.client.command_update(request_id, terminal[phase], "",
                                           f"robot reported {phase}" + (f": {detail}" if detail else ""))
                return
            await self.wait_brain(lambda b: state() != phase, min(1.0, end - time.monotonic()))
        self.client.command_update(request_id, pb.TIMED_OUT, "PB1405", "no terminal robot state in time")

    async def on_cancel(self, request_id: str) -> None:
        if self.lease_id is None:
            return
        motion = self.brain.get("motion") or {}
        action = "motion_cancel" if motion.get("motion_id") == request_id else "cancel"
        await self.request({"action": action, "lease_id": self.lease_id})

    async def on_setpoint(self, path: str, fields: dict, safe: bool, expires_in_ms: int) -> None:
        spec = self.mapping["setpoints"].get(path)
        if spec is None or self.lease_id is None:
            return
        if safe and self.brain.get("mode") != "MANUAL":
            # TTL/lease fallback: Brain only uses manual input in MANUAL. Sending a zero "manual" in AUTO/MOTION
            # would be read as an operator-style takeover and cancel navigation; the 0.2 s watchdog covers it.
            return
        body = transforms.substitute(spec["request"], fields)
        try:
            self.publish_request({**body, "lease_id": self.lease_id, "request_id": str(uuid.uuid4())})
        except RuntimeError:
            pass

    async def on_stop(self, request: pb.StopRequest) -> bool:
        stop = self.mapping["stop"]
        try:
            self.publish_request({**stop["request"], "request_id": request.request_id or str(uuid.uuid4())})
        except RuntimeError:
            return False
        confirm = stop["confirm"]
        return await self.wait_brain(lambda b: b.get(confirm["field"]) == confirm["equals"], confirm["withinMs"] / 1000)

    async def _derived(self) -> None:
        """Connection signals, attributes and a liveness heartbeat for low-rate sources."""
        while True:
            age = (time.monotonic() - self.brain_received) * 1000 if self.brain_received else None
            values = dict(self.attributes)
            if age is not None:
                values["Robot.Connection.StateAgeMs"] = round(age, 1)
                values["Robot.Connection.IsOnline"] = age <= 1000
            self.client.publish(values)
            await asyncio.sleep(0.2)

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.brain_changed = asyncio.Condition()
        self.start_ros()
        await asyncio.gather(self.client.run(), self._derived())


def main() -> None:
    parser = argparse.ArgumentParser(prog="protobus-ros2")
    parser.add_argument("--catalog", default=os.environ.get("PB_CATALOG", "/catalog/catalog.json"))
    parser.add_argument("--mapping", default=os.environ.get("PB_MAPPING", "/mapping/mapping.json"))
    parser.add_argument("--broker", default=os.environ.get("PB_BROKER", "protobus-broker:55500"))
    parser.add_argument("--safety", default=os.environ.get("PB_SAFETY", "protobus-broker:55501"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    mapping = json.loads(open(args.mapping, encoding="utf-8").read())
    catalog = Catalog.load(args.catalog)
    bridge = Bridge(mapping, catalog, args.broker, args.safety)
    log.info("protobus-ros2 profile=%s catalog=%s", mapping["profile"], catalog.hash)
    asyncio.run(bridge.run())


if __name__ == "__main__":
    main()
