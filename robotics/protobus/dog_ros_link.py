"""Read-only telemetry plus the single allowed control/request ROS writer.

All protocol state/futures belong to the asyncio loop. ROS callbacks only parse
and hand off through a bounded mailbox; no workflow, HTTP or physics logic runs
in them. This transport does not infer physical completion from an ACK.
"""
import asyncio
from dataclasses import dataclass
import json
import threading
import time
import uuid

import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.qos import qos_profile_sensor_data
from rosgraph_msgs.msg import Clock
from std_msgs.msg import String

from dog_protocol import DogProtocol, DogProtocolError
from mapping import strict_json
from provider import RejectedBeforeStart
from ros_telemetry import RosTelemetry


class DogLinkError(ConnectionError):
    """A sent action may have run; no physical status is implied."""


@dataclass
class Request:
    payload: dict
    source_epoch: str
    future: object


class DogRosLink:
    def __init__(self, engine, host_clock_id, *, authorize_sim_arm=False, on_epoch=None):
        self.loop = asyncio.get_running_loop()
        self.engine = engine
        self.protocol = DogProtocol(host_clock_id)
        self.authorize_sim_arm = authorize_sim_arm and engine.profile.get('allowRemoteArm', False)
        self.on_epoch = on_epoch
        self.lock = threading.Lock()
        self.mailbox = {}
        self.pending = {}
        self.scheduled = False
        self.closed = False
        self.error = None
        self.motion = None
        self.motion_received_ns = 0
        self.sim = None
        self.sim_received_ns = 0
        self.clock_received_ns = 0
        self.namespace = engine.profile['ros']['namespace'].rstrip('/')
        self.node = Node('protobus_ros_link_'+uuid.uuid4().hex[:8])
        results = self.node.set_parameters([Parameter('use_sim_time', Parameter.Type.BOOL, True)])
        if not all(item.successful for item in results):
            raise DogLinkError('SIM clock parameter rejected')
        self.publisher = self.node.create_publisher(String, self.namespace+'/control/request', 1)
        self.telemetry = RosTelemetry(self.node, engine, self.loop, lambda: self.protocol.source_epoch)
        self.subscriptions = [
            self.node.create_subscription(String, self.namespace+'/brain/state',
                lambda message: self.receive('brain', message), 1),
            self.node.create_subscription(String, self.namespace+'/motion/state',
                lambda message: self.receive('motion', message), 1),
            self.node.create_subscription(String, self.namespace+'/sim/state',
                lambda message: self.receive('sim', message), 1),
            self.node.create_subscription(String, self.namespace+'/control/ack',
                lambda message: self.receive('ack', message), 10),
            self.node.create_subscription(Clock, '/clock', lambda _: self.clock_seen(), qos_profile_sensor_data)]
        self.executor = SingleThreadedExecutor()
        self.executor.add_node(self.node)
        self.thread = threading.Thread(target=self.executor.spin, name='protobus-ros-reader', daemon=True)
        self.thread.start()

    def clock_seen(self):
        self.clock_received_ns = time.monotonic_ns()

    def receive(self, kind, message):
        try:
            if len(message.data) > 2_000_000:
                raise ValueError('ROS JSON frame exceeds bound')
            payload = strict_json(message.data)
            if not isinstance(payload, dict):
                raise ValueError('ROS JSON object required')
            received = time.monotonic_ns()
            with self.lock:
                if self.closed:
                    return
                if kind == 'ack':
                    rid = payload.get('request_id')
                    if not isinstance(rid, str) or rid not in self.pending:
                        return
                    key = 'ack:'+rid
                else:
                    key = kind
                self.mailbox[key] = (kind, payload, received)
                if not self.scheduled:
                    self.scheduled = True
                    self.loop.call_soon_threadsafe(self.drain)
        except (ValueError, TypeError, RuntimeError) as error:
            self.error = str(error)[:200]

    def fail_pending(self, reason):
        with self.lock:
            requests, self.pending = list(self.pending.values()), {}
        for request in requests:
            if not request.future.done():
                request.future.set_exception(DogLinkError(reason))

    def drain(self):
        with self.lock:
            messages, self.mailbox = self.mailbox, {}
            self.scheduled = False
            if self.closed:
                return
        for kind, payload, received in messages.values():
            try:
                if kind == 'brain':
                    previous = self.protocol.source_epoch
                    changed = self.protocol.update_brain(payload, received)
                    if changed or previous is None:
                        self.engine.reset(self.protocol.source_epoch)
                    if changed:
                        self.fail_pending('dog source epoch changed after request')
                        if self.on_epoch:
                            self.on_epoch(self.protocol.source_epoch)
                    self.error = None
                elif kind == 'motion':
                    self.motion, self.motion_received_ns = payload, received
                elif kind == 'sim':
                    self.sim, self.sim_received_ns = payload, received
                elif kind == 'ack':
                    with self.lock:
                        request = self.pending.pop(payload['request_id'], None)
                    if request and not request.future.done():
                        if (request.source_epoch != self.protocol.source_epoch
                                or payload.get('schema') != 1 or payload.get('source') != 'SIM'
                                or payload.get('config_hash') != request.payload['config_hash']
                                or type(payload.get('accepted')) is not bool):
                            request.future.set_exception(DogLinkError('ACK identity/protocol mismatch'))
                        else:
                            request.future.set_result(payload)
            except (ValueError, TypeError, KeyError) as error:
                self.error = str(error)[:200]
                self.fail_pending('invalid dog source frame')

    async def wait(self, predicate, timeout=3):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            await asyncio.sleep(.01)
        raise DogLinkError('dog feedback timeout: '+str(self.error or 'condition not observed'))

    def ready(self):
        now = time.monotonic_ns()
        return (not self.error and self.protocol.brain is not None
                and now-self.protocol.received_ns < 300_000_000
                and now-self.clock_received_ns < 300_000_000
                and self.node.get_clock().now().nanoseconds > 0)

    async def wait_ready(self, timeout=20):
        await self.wait(self.ready, timeout)

    def send(self, action, controller=None, **fields):
        if self.closed:
            raise RejectedBeforeStart('ROS link closed before dispatch')
        if action == 'arm' and not self.authorize_sim_arm:
            raise RejectedBeforeStart('explicit SIM Arm authorization is disabled')
        if action not in ('stop', 'disarm') and not self.ready():
            raise RejectedBeforeStart('fresh ROS source and clock required')
        rid = str(uuid.uuid4())
        try:
            payload = self.protocol.envelope(action, rid, self.node.get_clock().now().nanoseconds,
                                             controller, **fields)
        except DogProtocolError as error:
            raise RejectedBeforeStart(str(error)) from error
        future = self.loop.create_future()
        request = Request(payload, self.protocol.source_epoch, future)
        with self.lock:
            if len(self.pending) >= 64:
                if action != 'stop':
                    raise RejectedBeforeStart('ROS request queue full before dispatch')
                key = next((key for key, item in self.pending.items()
                            if item.payload['action'] != 'stop'), next(iter(self.pending)))
                oldest = self.pending.pop(key)
                if not oldest.future.done():
                    oldest.future.set_exception(DogLinkError('preempted by emergency STOP'))
            self.pending[rid] = request
        try:
            self.publisher.publish(String(data=json.dumps(payload, allow_nan=False)))
        except Exception as error:
            with self.lock:
                self.pending.pop(rid, None)
            future.cancel()
            raise DogLinkError('ROS publish outcome unknown') from error
        return request

    async def response(self, request, timeout=2):
        try:
            ack = await asyncio.wait_for(asyncio.shield(request.future), timeout)
            if request.source_epoch != self.protocol.source_epoch:
                raise DogLinkError('dog epoch changed before ACK consumption')
            return ack
        finally:
            with self.lock:
                self.pending.pop(request.payload['request_id'], None)
            if not request.future.done():
                request.future.cancel()

    async def request(self, action, controller=None, **fields):
        request = self.send(action, controller, **fields)
        return await self.response(request)

    def close(self):
        self.telemetry.close()
        with self.lock:
            self.closed = True
            self.mailbox.clear()
        self.fail_pending('ROS link closed')
        self.executor.shutdown(timeout_sec=2)
        self.thread.join(2)
        self.node.destroy_node()
