"""ROS-free provider transport and receive-side authority/deadline enforcement.

Backend callbacks own their actual state and must only confirm observed results.
The live ROS adapter and kinematic mock share this wire layer, not their models.
"""
import asyncio
import copy
import itertools
import json
import math
from pathlib import Path
import time
import uuid

import grpc
from identity import validate_context
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

KINDS = {'bool': 'bool_value', 'int32': 'int32_value', 'int64': 'int64_value',
         'uint8': 'uint32_value', 'uint32': 'uint32_value', 'float32': 'float32_value',
         'float64': 'float64_value', 'string': 'string_value', 'enum': 'string_value'}


class RejectedBeforeStart(ValueError):
    """Backend proves the command was not forwarded or admitted."""


def scalar_value(value, node):
    return pb.Value(**{KINDS[node['type']]: value})


def scalar_from_wire(value, node):
    kind = value.WhichOneof('kind')
    if kind != KINDS[node['type']]:
        raise ValueError('exact wire type required')
    scalar = getattr(value, kind)
    if isinstance(scalar, float) and not math.isfinite(scalar):
        raise ValueError('nonfinite scalar')
    if ('min' in node and scalar < node['min']) or ('max' in node and scalar > node['max']):
        raise ValueError('scalar outside bounds')
    if node['type'] == 'enum' and scalar not in node['values']:
        raise ValueError('unknown enum')
    if node['type'] == 'uint8' and scalar > 255:
        raise ValueError('uint8 overflow')
    return scalar


class AuthorityGuard:
    """Pure receive-side fence/sequence state. No callback can bypass this guard."""
    def __init__(self, epoch, session):
        self.epoch, self.session = epoch, session
        self.fence = 0
        self.invalid_through = 0
        self.lease_deadline = 0
        self.sequences = {}
        self.targets = {}
        self.cancelled = set()
        self.seen = set()

    def envelope(self, message):
        return message.broker_epoch == self.epoch and message.provider_session == self.session

    def grant(self, message, now):
        if (not self.envelope(message) or message.fence <= self.invalid_through
                or message.fence < self.fence or message.deadline_monotonic_ns <= now):
            return False
        if message.fence > self.fence:
            self.fence = message.fence
            self.sequences.clear()
            self.targets.clear()
            self.cancelled.clear()
            self.seen.clear()
            self.lease_deadline = message.deadline_monotonic_ns
        else:
            self.lease_deadline = max(self.lease_deadline, message.deadline_monotonic_ns)
        return True

    def valid(self, message, now):
        return (self.envelope(message) and message.fence == self.fence
                and message.fence > self.invalid_through and now < self.lease_deadline)

    def target(self, message, now):
        if (not self.valid(message, now) or message.deadline_monotonic_ns <= now
                or message.deadline_monotonic_ns > self.lease_deadline
                or message.sequence <= self.sequences.get(message.path, 0)):
            return False
        self.sequences[message.path] = message.sequence
        self.targets[message.path] = copy.deepcopy(message)
        return True

    def safe(self, message):
        if (not self.envelope(message) or message.fence != self.fence
                or message.fence <= self.invalid_through
                or message.sequence < self.sequences.get(message.path, 0)):
            return False
        self.sequences[message.path] = message.sequence
        self.targets.pop(message.path, None)
        return True

    def revoke(self, message):
        if not self.envelope(message):
            return False
        self.invalid_through = max(self.invalid_through, message.fence)
        if message.fence < self.fence:
            return False
        self.lease_deadline = 0
        self.targets.clear()
        return True

    def invocation(self, message, now):
        if (not self.valid(message, now) or message.deadline_monotonic_ns <= now
                or not message.execution_id or message.execution_id in self.cancelled
                or message.execution_id in self.seen or len(self.seen) >= 1024):
            return False
        self.seen.add(message.execution_id)
        return True


class ProviderClient:
    def __init__(self, endpoint, catalog, backend, provider_id='mock', profile_id='dog-go2-sim'):
        self.endpoint, self.catalog, self.backend = endpoint, catalog, backend
        self.provider_id, self.profile_id = provider_id, profile_id
        self.backend.client = self
        self.guard = None
        self.connected = asyncio.Event()
        self.restart = asyncio.Event()
        self.outgoing = None
        self.counter = itertools.count()
        self.tasks = []
        self.commands = {}
        self.command_messages = {}
        self.started_commands = set()
        self.cancel_requests = set()
        self.stop_waiters = set()
        self.target_releases={}
        self.stop_task = None
        self.sequence = 0
        self.closing = False

    async def send(self, packet, priority=10):
        if self.closing or self.outgoing is None:
            raise ConnectionError('provider data session is closed')
        future = asyncio.get_running_loop().create_future()
        try:
            await asyncio.wait_for(self.outgoing.put((priority, next(self.counter), packet, future)), .5)
            return await asyncio.wait_for(asyncio.shield(future), 1)
        except BaseException:
            future.cancel()
            raise

    async def feedback(self, message, phase, reason='', confirmed=False,target_sequence=0):
        return await self.send(pb.ProviderPacket(command=pb.CommandUpdate(
            execution_id=message.execution_id, path=message.path, phase=phase,
            reason=reason[:1024], physical_confirmed=confirmed,
            provider_session=self.guard.session,target_sequence=target_sequence)), priority=0)

    async def sender(self, call):
        while True:
            _, _, packet, future = await self.outgoing.get()
            try:
                await call.write(packet)
                ack = await call.read()
                if ack is grpc.aio.EOF or not ack.ok:
                    raise ConnectionError('provider packet rejected: '+getattr(ack, 'code', 'EOF'))
                if not future.done():
                    future.set_result(ack)
            except BaseException as error:
                if not future.done():
                    future.set_exception(error)
                raise
            finally:
                self.outgoing.task_done()

    async def heartbeat(self):
        while True:
            await self.send(pb.ProviderPacket(heartbeat_session=self.guard.session), priority=5)
            await asyncio.sleep(.1)

    async def telemetry(self):
        while True:
            values = self.backend.values()
            samples = []
            stamp = time.monotonic_ns()
            for path, scalar in values.items():
                node = self.catalog['nodes'].get(path)
                if not node or node['kind'] not in ('sensor', 'attribute') or node.get('generated'):
                    continue
                self.sequence += 1
                quality = self.backend.quality(path) if hasattr(self.backend, 'quality') else pb.OK
                metadata = (self.backend.sample_metadata(path) if hasattr(self.backend, 'sample_metadata') else {})
                sample = pb.Sample(path=path, sequence=self.sequence,
                    quality=pb.NONE if scalar is None else quality, source_time_ns=stamp,
                    source_clock='MONOTONIC', source_epoch=self.guard.session)
                for key in ('source_time_ns', 'source_clock', 'source_epoch'):
                    if key in metadata:
                        setattr(sample, key, metadata[key])
                if scalar is not None and sample.quality != pb.NONE:
                    sample.value.CopyFrom(scalar_value(scalar, node))
                samples.append(sample)
            if samples:
                await self.send(pb.ProviderPacket(samples=pb.Samples(samples=samples,
                    provider_session=self.guard.session)))
            await asyncio.sleep(.05)

    async def run_command(self, message):
        self.started_commands.add(message.execution_id)
        async def progress(phase, reason='', confirmed=False):
            await self.feedback(message, phase, reason, confirmed)
        try:
            args = {name: scalar_from_wire(value, self.catalog['nodes'][message.path]['args'][name])
                    for name, value in message.value.fields.items()}
            phase, reason, confirmed = await self.backend.command(message.path, args, progress)
            await self.feedback(message, phase, reason, confirmed=confirmed)
        except asyncio.CancelledError:
            # Backend command cancellation performs its own recovery before
            # propagating or returning. Transport loss cannot fabricate success.
            if not self.closing:
                await self.feedback(message, pb.CANCELLED, 'physical cancellation not confirmed', False)
            raise
        except RejectedBeforeStart as error:
            await self.feedback(message, pb.REJECTED, str(error), True)
        except Exception as error:
            self.backend.request_stop()
            if not self.closing:
                await self.feedback(message, pb.FAILED, 'backend error: '+str(error), False)
            self.restart.set()
        finally:
            self.commands.pop(message.execution_id, None)
            self.command_messages.pop(message.execution_id, None)
            self.started_commands.discard(message.execution_id)
            self.cancel_requests.discard(message.execution_id)

    def command_done(self, task, message):
        if self.commands.get(message.execution_id) is task:
            # A task cancelled before its first instruction never reached the
            # backend and can truthfully confirm that no physical work began.
            self.commands.pop(message.execution_id, None)
            self.command_messages.pop(message.execution_id, None)
            self.cancel_requests.discard(message.execution_id)
            if task.cancelled() and not self.closing:
                reply = asyncio.create_task(self.feedback(message, pb.CANCELLED, 'cancelled before start', True))
                self.stop_waiters.add(reply)
                reply.add_done_callback(self.background_done)
        if not task.cancelled():
            error = task.exception()
            if error is not None and not self.closing:
                self.backend.request_stop()
                self.restart.set()

    def background_done(self, task):
        self.stop_waiters.discard(task)
        if not task.cancelled() and task.exception() is not None and not self.closing:
            self.backend.request_stop()
            self.restart.set()

    def cancel_command(self, execution_id):
        if len(self.guard.cancelled) < 1024:
            self.guard.cancelled.add(execution_id)
        task = self.commands.get(execution_id)
        if task and execution_id not in self.cancel_requests:
            self.cancel_requests.add(execution_id)
            task.cancel()

    def cancel_all(self):
        for execution_id in tuple(self.commands):
            self.cancel_command(execution_id)

    async def finish_stop(self, message):
        try:
            await self.feedback(message, pb.ACCEPTED, 'provider received STOP')
            if self.stop_task is None or self.stop_task.done():
                self.stop_task = asyncio.create_task(self.backend.stop())
            await asyncio.shield(self.stop_task)
            await self.feedback(message, pb.SUCCEEDED, 'backend stop confirmed', True)
        except (ConnectionError, grpc.aio.AioRpcError):
            return

    async def apply_target(self,message,release):
        try:
            await self.backend.apply_target(message.path,message.value,0 if release else message.deadline_monotonic_ns)
            await self.feedback(message,pb.SUCCEEDED if release else pb.RUNNING,
                'backend safe release' if release else 'backend target admission',release,message.sequence)
        except asyncio.CancelledError:raise
        except Exception:
            self.backend.request_stop()
            if not self.closing:
                await self.feedback(message,pb.FAILED,'target application unconfirmed',False,message.sequence)
            self.restart.set()

    async def control_loop(self, stream, safety=False):
        async for message in stream:
            now = time.monotonic_ns()
            if not self.guard.envelope(message):
                continue
            if message.kind not in (pb.STOP, pb.LEASE_REVOKED) and self.expire_targets(now):
                return
            if message.kind == pb.LEASE_UPDATE and not safety:
                previous = self.guard.fence
                previous_targets = tuple(self.guard.targets)
                if self.guard.grant(message, now) and self.guard.fence != previous:
                    for path in previous_targets:
                        node = self.catalog['nodes'][path]
                        self.backend.target(path, pb.Object(fields={name: scalar_value(value, node['fields'][name])
                            for name, value in node['safeValue'].items()}), 0)
                    if self.commands:
                        self.cancel_all()
                        self.backend.lost('NEW_LEASE_FENCE')
            elif message.kind == pb.SET_TARGET and not safety:
                if self.guard.target(message, now):
                    await self.apply_target(message,False)
            elif message.kind == pb.SAFE_VALUE and safety:
                if self.guard.safe(message):
                    self.backend.target(message.path, message.value, 0)
                    if message.execution_id and message.execution_id not in self.target_releases:
                        task=asyncio.create_task(self.apply_target(copy.deepcopy(message),True))
                        self.target_releases[message.execution_id]=task
                        self.stop_waiters.add(task)
                        def finished(task,identity=message.execution_id):
                            self.target_releases.pop(identity,None);self.background_done(task)
                        task.add_done_callback(finished)
            elif message.kind == pb.LEASE_REVOKED and safety:
                if self.guard.revoke(message):
                    self.cancel_all()
                    self.backend.lost(message.reason)
            elif message.kind == pb.STOP and safety:
                if self.guard.revoke(message):
                    self.cancel_all()
                    self.backend.request_stop()
                    if len(self.stop_waiters) >= 32:
                        next(iter(self.stop_waiters)).cancel()
                    task = asyncio.create_task(self.finish_stop(message))
                    self.stop_waiters.add(task)
                    task.add_done_callback(self.background_done)
            elif message.kind == pb.CANCEL and safety:
                if message.fence == self.guard.fence and message.fence > self.guard.invalid_through:
                    existed = message.execution_id in self.commands
                    self.cancel_command(message.execution_id)
                    if not existed:
                        await self.feedback(message, pb.CANCELLED, 'cancelled before execution', True)
            elif message.kind == pb.INVOKE and not safety:
                if self.guard.invocation(message, now):
                    if self.commands:
                        await self.feedback(message, pb.REJECTED, 'provider body resource busy', True)
                    else:
                        task = asyncio.create_task(self.run_command(message))
                        self.commands[message.execution_id] = task
                        self.command_messages[message.execution_id] = copy.deepcopy(message)
                        task.add_done_callback(lambda task, message=copy.deepcopy(message): self.command_done(task, message))
                # Invalid/replayed dispatches never actuate and never contradict
                # an already confirmed result. Broker timeout/cancel establishes
                # their logical terminal state.
        raise ConnectionError('provider lane ended')

    def expire_targets(self, now):
        # Check before accepting a newly arrived refresh as well as on the timer:
        # a delayed event-loop wake must not hide a gap beyond the previous TTL.
        for path, message in tuple(self.guard.targets.items()):
            if now >= message.deadline_monotonic_ns:
                self.guard.invalid_through = max(self.guard.invalid_through, self.guard.fence)
                self.guard.lease_deadline = 0
                self.guard.targets.clear()
                node = self.catalog['nodes'][path]
                self.backend.target(path, pb.Object(fields={name: scalar_value(value, node['fields'][name])
                    for name, value in node['safeValue'].items()}), 0)
                self.cancel_all()
                self.backend.lost('LOCAL_TARGET_EXPIRED')
                self.restart.set()
                return True
        return False

    async def watchdog(self):
        context_check=0
        while True:
            now = time.monotonic_ns()
            if now>=context_check:
                context_check=now+100_000_000
                if self.backend.target_context(self.guard.session)!=self.target_context:
                    self.cancel_all();self.backend.lost('TARGET_CONTEXT_CHANGED');self.restart.set();return
            if self.guard.lease_deadline and now >= self.guard.lease_deadline:
                self.guard.invalid_through = max(self.guard.invalid_through, self.guard.fence)
                self.guard.lease_deadline = 0
                self.guard.targets.clear()
                self.cancel_all()
                self.backend.lost('LOCAL_LEASE_EXPIRED')
            self.expire_targets(now)
            for message in tuple(self.command_messages.values()):
                if now >= message.deadline_monotonic_ns:
                    self.cancel_command(message.execution_id)
            await asyncio.sleep(.01)

    async def session(self):
        normal = grpc.aio.insecure_channel(self.endpoint)
        safety_channel = grpc.aio.insecure_channel(self.endpoint, options=[('grpc.use_local_subchannel_pool', 1)])
        call = control = safety = None
        self.closing = False
        self.restart.clear()
        self.outgoing = asyncio.PriorityQueue(maxsize=256)
        try:
            await asyncio.wait_for(normal.channel_ready(), 5)
            descriptor = await rpc.BusStub(normal).Describe(pb.Empty(), timeout=2)
            clock = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            if (descriptor.backend != 'SIM' or descriptor.catalog_hash != self.catalog['catalogHash']
                    or descriptor.protocol_version != '1.6' or descriptor.host_clock_id != clock):
                raise ConnectionError('provider descriptor/catalog/clock mismatch')
            self.guard = AuthorityGuard(descriptor.broker_epoch, str(uuid.uuid4()))
            self.target_context=validate_context(self.backend.target_context(self.guard.session))
            self.sequence = 0
            claims = [path for path, node in self.catalog['nodes'].items()
                      if not path.startswith('Robot.Connection.') and not node.get('generated')]
            hello = pb.ProviderHello(provider_id=self.provider_id, profile_id=self.profile_id,
                catalog_hash=self.catalog['catalogHash'], session=self.guard.session,
                claims=claims, backend='SIM', host_clock_id=clock, protocol_version='1.6',
                target_context=self.target_context)
            provider = rpc.ProviderStub(normal)
            call = provider.Attach()
            await call.write(pb.ProviderPacket(hello=hello))
            ack = await call.read()
            if not ack.ok:
                raise ConnectionError('provider hello rejected')
            control = provider.Control(hello)
            safety = rpc.ProviderStub(safety_channel).Safety(hello)
            await asyncio.wait_for(asyncio.gather(control.initial_metadata(), safety.initial_metadata()), 3)
            self.tasks = [asyncio.create_task(self.sender(call)),
                          asyncio.create_task(self.control_loop(control)),
                          asyncio.create_task(self.control_loop(safety, True)),
                          asyncio.create_task(self.watchdog()), asyncio.create_task(self.heartbeat()),
                          asyncio.create_task(self.telemetry()), asyncio.create_task(self.restart.wait())]
            self.connected.set()
            done, _ = await asyncio.wait(self.tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            self.connected.clear()
            self.closing = True
            self.cancel_all()
            self.backend.lost('PROVIDER_SESSION_LOST')
            for task in self.tasks + list(self.stop_waiters):
                task.cancel()
            if self.stop_task is not None:
                self.stop_task.cancel()
            await asyncio.gather(*self.tasks, *self.stop_waiters, return_exceptions=True)
            for stream in (call, control, safety):
                if stream:
                    stream.cancel()
            await normal.close()
            await safety_channel.close()
            if self.commands:
                try:
                    await asyncio.wait_for(asyncio.gather(*self.commands.values(), return_exceptions=True), 1)
                except asyncio.TimeoutError:
                    pass
            self.commands.clear()
            self.command_messages.clear()
            self.started_commands.clear()
            self.stop_waiters.clear()
            self.cancel_requests.clear()
            self.outgoing = None

    async def run(self):
        while True:
            try:
                await self.session()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                print(json.dumps({'provider': self.provider_id, 'session_error': str(error)[:300]}), flush=True)
            await asyncio.sleep(.2)
