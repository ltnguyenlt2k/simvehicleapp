"""Explicit kinematic mock provider. No ROS, physics or hardware claims."""
import argparse
import asyncio
from collections import defaultdict, deque
import json
import math
from pathlib import Path
import time

import grpc
from provider import ProviderClient, RejectedBeforeStart, scalar_from_wire
from identity import data_hash,source_hash
from protobus.v1 import protobus_pb2 as pb
from protobus.mock.v1 import mock_pb2 as mpb
from protobus.mock.v1 import mock_pb2_grpc as mrpc


class MockBackend:
    def target_context(self,session):
        return pb.TargetContext(kind=pb.KINEMATIC_MOCK,mapping_hash=data_hash(self.profile),
            adapter_source_hash=source_hash(),source_epoch=session,remote_arm_authorized=True)

    def __init__(self, catalog, profile=None):
        self.catalog = catalog
        self.profile = profile or json.loads((Path(__file__).parent/'profiles/mock-go2.json').read_text())
        if self.profile.get('timeScale', 1) != 1:
            raise ValueError('v0.1 supports timeScale=1 only')
        self.client = None
        self.revision = 0
        self.scenario_task = None
        self.reset()

    def reset(self):
        self.x = self.y = self.yaw = self.v = self.w = 0.0
        self.target_deadline = 0
        self.mode = 'DISARMED'
        self.stop_latched = False
        self.motion_active = False
        self.motion_name = ''
        self.reason = 'Kinematic mock; no physical simulation'
        self.last_tick = self.start_time = time.monotonic_ns()
        self.overrides = {}
        self.forced = defaultdict(deque)
        self.revision += 1

    def tick(self):
        now = time.monotonic_ns()
        until = min(now, self.target_deadline) if self.target_deadline else now
        dt = max(0, until-self.last_tick)/1e9
        if abs(self.w) > 1e-9:
            self.x += self.v/self.w*(math.sin(self.yaw+self.w*dt)-math.sin(self.yaw))
            self.y += -self.v/self.w*(math.cos(self.yaw+self.w*dt)-math.cos(self.yaw))
        else:
            self.x += self.v*dt*math.cos(self.yaw)
            self.y += self.v*dt*math.sin(self.yaw)
        self.yaw = math.atan2(math.sin(self.yaw+self.w*dt), math.cos(self.yaw+self.w*dt))
        self.last_tick = now
        if self.target_deadline and now >= self.target_deadline:
            self.v = self.w = 0.0
            self.target_deadline = 0

    def target(self, path, value, deadline):
        self.tick()
        if path != 'Robot.Motion.Velocity':
            raise ValueError('mock has no such actuator')
        fields = self.catalog['nodes'][path]['fields']
        values = {key: scalar_from_wire(item, fields[key]) for key, item in value.fields.items()}
        if self.mode == 'MANUAL' and not self.stop_latched:
            self.v, self.w = values.get('LinearX', 0), values.get('AngularZ', 0)
            self.target_deadline = deadline
        else:
            self.v = self.w = 0.0
            self.target_deadline = 0
            self.reason = 'Setpoint ignored outside MANUAL'

    def request_stop(self):
        self.tick()
        self.v = self.w = 0.0
        self.target_deadline = 0
        self.stop_latched = True
        self.mode = 'SAFE_STOP'
        self.reason = 'Software STOP in kinematic mock'

    def lost(self, reason):
        if self.mode != 'DISARMED' or self.motion_active or abs(self.v)+abs(self.w) > 0:
            self.request_stop()
        self.reason = reason

    async def apply_target(self,path,value,deadline):
        if deadline and self.mode!='MANUAL':raise RejectedBeforeStart('target requires MANUAL')
        self.target(path,value,deadline)
        if not deadline and (self.v!=0 or self.w!=0 or self.motion_active):
            raise ConnectionError('mock safe release not observed')

    async def stop(self):
        self.request_stop()
        while self.motion_active:
            await asyncio.sleep(.01)

    def quality(self, path):
        return self.overrides.get(path, (None, pb.OK))[1]

    def values(self):
        self.tick()
        values = {}
        for path, node in self.catalog['nodes'].items():
            if node['kind'] not in ('sensor', 'attribute') or node.get('generated') or path.startswith('Robot.Connection.'):
                continue
            typ = node['type']
            value = (False if typ == 'bool' else node['values'][0] if typ == 'enum'
                     else '' if typ == 'string' else max(node.get('min', 0), 0))
            values[path] = value
        values.update({
            'Robot.Identity.Id': 'dog1', 'Robot.Identity.Model': 'Go2 kinematic mock',
            'Robot.Identity.Backend': 'SIM', 'Robot.Identity.ProfileId': 'dog-go2-sim',
            'Robot.Safety.Mode': self.mode, 'Robot.Safety.Reason': self.reason,
            'Robot.Safety.IsArmed': self.mode in ('MANUAL', 'AUTO', 'MOTION'),
            'Robot.Safety.IsStopLatched': self.stop_latched,
            'Robot.Pose.Position.X': self.x, 'Robot.Pose.Position.Y': self.y,
            'Robot.Pose.Position.Z': .3, 'Robot.Pose.Orientation.Yaw': self.yaw,
            'Robot.Velocity.Linear.X': self.v, 'Robot.Velocity.Linear.Y': 0., 'Robot.Velocity.Angular.Z': self.w,
            'Robot.Imu.LinearAcceleration.Z': 9.81,
            'Robot.PowerSystem.Battery.StateOfCharge': max(0, 95-(time.monotonic_ns()-self.start_time)/1e9*.001),
            'Robot.PowerSystem.Battery.Voltage': 28.5, 'Robot.PowerSystem.Battery.Current': .4,
            'Robot.Perception.Obstacle.MinDistance': 4., 'Robot.Perception.Obstacle.FrontMinDistance': 4.,
            'Robot.Simulation.SceneId': 'courtyard', 'Robot.Simulation.IsPaused': False,
            'Robot.Simulation.TimeNs': time.monotonic_ns()-self.start_time,
        })
        for leg in ('FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'):
            values[f'Robot.Leg.{leg}.Foot.IsInContact'] = True
            values[f'Robot.Leg.{leg}.Foot.ContactForce'] = 25.
        for path, (value, quality) in self.overrides.items():
            values[path] = None if quality == pb.NONE else value
        return {path: value for path, value in values.items() if path in self.catalog['nodes']}

    async def command(self, path, args, progress,*,execution_id=None):
        is_recovery = path in ('Robot.Safety.ResetStop', 'Robot.Safety.Disarm')
        if self.stop_latched and not is_recovery:
            raise RejectedBeforeStart('STOP latched')
        if path == 'Robot.Safety.Arm' and self.mode != 'DISARMED':
            raise RejectedBeforeStart('Arm requires DISARMED')
        if path == 'Robot.Safety.ResetStop' and (self.motion_active or self.mode not in ('DISARMED', 'SAFE_STOP')):
            raise RejectedBeforeStart('Reset requires recovered/disarmed state')
        if path.startswith(('Robot.Motion.', 'Robot.Navigation.')) and self.mode != 'MANUAL':
            raise RejectedBeforeStart('command requires MANUAL')
        if path == 'Robot.Motion.Perform':
            if (args['Name'] not in self.profile['motionDurationSeconds'] or abs(self.v)+abs(self.w) > .02
                    or math.hypot(self.x, self.y) > .6
                    or self.values()['Robot.Perception.Obstacle.FrontMinDistance'] < 1):
                raise RejectedBeforeStart('motion preconditions not met')
        if path == 'Robot.Navigation.FollowRoute' and args['RouteId'] not in self.profile.get('routes', {}):
            raise RejectedBeforeStart('unknown versioned route ID')
        forced = self.forced[path].popleft() if self.forced[path] else None
        if forced == pb.REJECTED:
            raise RejectedBeforeStart('scenario forced rejection')
        prior_mode = self.mode
        self.motion_active = True
        try:
            await progress(pb.ACCEPTED, 'mock admitted command')
            await progress(pb.RUNNING, 'mock execution')
            if forced == pb.TIMED_OUT:
                await asyncio.Event().wait()
            if forced == pb.FAILED:
                return pb.FAILED, 'scenario forced failure', True
            if path == 'Robot.Safety.Arm':
                self.mode = 'MANUAL'
            elif path in ('Robot.Safety.Disarm', 'Robot.Safety.ResetStop'):
                self.v = self.w = 0.
                self.mode = 'DISARMED'
                if path.endswith('ResetStop'):
                    self.stop_latched = False
            elif path == 'Robot.Motion.Perform':
                self.v = self.w = 0.
                self.mode = 'MOTION'
                self.motion_name = args['Name']
                await asyncio.sleep(self.profile['motionDurationSeconds'][args['Name']])
                self.mode = 'MANUAL'
            elif path.startswith('Robot.Navigation.'):
                points = ([[args['X'], args['Y']]] if path.endswith('GoTo')
                          else self.profile['routes'][args['RouteId']])
                self.mode = 'AUTO'
                for x, y in points:
                    while math.hypot(x-self.x, y-self.y) > .04:
                        if self.stop_latched:
                            return pb.FAILED, 'mock navigation stopped', True
                        self.tick()
                        error = math.atan2(math.sin(math.atan2(y-self.y, x-self.x)-self.yaw),
                                           math.cos(math.atan2(y-self.y, x-self.x)-self.yaw))
                        self.v = min(.25, math.hypot(x-self.x, y-self.y)) * max(0, math.cos(error))
                        self.w = max(-.65, min(.65, error*2))
                        self.target_deadline = time.monotonic_ns()+100_000_000
                        await asyncio.sleep(.02)
                self.v = self.w = 0.
                self.mode = 'MANUAL'
            else:
                return pb.REJECTED, 'unsupported mock command', True
            return pb.SUCCEEDED, 'mock model completed', True
        except asyncio.CancelledError:
            if not self.client or self.client.cancel_causes.get(execution_id)!='USER_CANCEL':self.request_stop()
            self.v = self.w = 0.
            await asyncio.sleep(self.profile.get('recoverySeconds', .25))
            self.mode = 'SAFE_STOP' if self.stop_latched else ('DISARMED' if prior_mode == 'DISARMED' else 'MANUAL')
            return pb.CANCELLED, 'mock recovery completed', True
        finally:
            self.motion_active = False
            self.motion_name = ''


class MockControl(mrpc.MockControlServicer):
    def __init__(self, backend):
        self.backend = backend

    async def State(self, request, context):
        backend = self.backend
        backend.tick()
        client = backend.client
        return mpb.StateReply(model='synthetic-unicycle', mode=backend.mode,
            linear_x=backend.v, angular_z=backend.w, x=backend.x, y=backend.y,
            stop_latched=backend.stop_latched, motion_active=backend.motion_active,
            connected=bool(client and client.connected.is_set()), revision=backend.revision,
            session=client.guard.session if client and client.guard else '')

    async def Reset(self, request, context):
        backend = self.backend
        guard = backend.client.guard
        if request.time_scale not in (0, 1):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'timeScale=1 only')
        if (backend.motion_active or backend.client.commands or backend.client.stop_waiters
                or (guard and time.monotonic_ns() < guard.lease_deadline)):
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, 'active run/lease')
        if backend.scenario_task:
            backend.scenario_task.cancel()
            await asyncio.gather(backend.scenario_task, return_exceptions=True)
        backend.reset()
        backend.request_stop() # A scenario reset cannot clear the broker's latched Stop.
        backend.client.restart.set()
        return mpb.ResetReply(revision=backend.revision)

    async def Schedule(self, request, context):
        backend = self.backend
        if not 1 <= len(request.steps) <= 256:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'scenario step count')
        for step in request.steps:
            if step.at_ms > 3600000:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'scenario horizon')
            action = step.WhichOneof('action')
            if action == 'sensor':
                item = step.sensor
                node = backend.catalog['nodes'].get(item.path)
                if (node is None or node['kind'] != 'sensor' or node.get('generated')
                        or item.path.startswith(('Robot.Safety.', 'Robot.Connection.'))
                        or item.quality not in (pb.OK, pb.STALE, pb.NONE)):
                    await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'scenario sensor not injectable')
                try:
                    if item.quality != pb.NONE:
                        scalar_from_wire(item.value, node)
                    elif item.value.WhichOneof('kind') is not None:
                        raise ValueError('NONE cannot carry value')
                except ValueError as error:
                    await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error))
            elif action == 'command_result':
                item = step.command_result
                node = backend.catalog['nodes'].get(item.path)
                if (not node or node['kind'] != 'command' or item.path.startswith('Robot.Safety.')
                        or item.phase not in (pb.REJECTED, pb.FAILED, pb.TIMED_OUT) or not 1 <= item.count <= 100):
                    await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'scenario result')
            else:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'scenario action')
        if backend.scenario_task:
            backend.scenario_task.cancel()
            await asyncio.gather(backend.scenario_task, return_exceptions=True)
        backend.overrides.clear()
        backend.forced.clear()
        backend.scenario_task = asyncio.create_task(self.apply_steps(list(request.steps)))
        return mpb.ScenarioReply(scheduled_steps=len(request.steps))

    async def apply_steps(self, steps):
        start = time.monotonic()
        for step in sorted(steps, key=lambda item: item.at_ms):
            await asyncio.sleep(max(0, start+step.at_ms/1000-time.monotonic()))
            if step.WhichOneof('action') == 'sensor':
                item = step.sensor
                value = None if item.quality == pb.NONE else scalar_from_wire(item.value, self.backend.catalog['nodes'][item.path])
                self.backend.overrides[item.path] = (value, item.quality)
            else:
                item = step.command_result
                self.backend.forced[item.path].extend([item.phase]*item.count)


async def serve(args):
    catalog = json.loads(Path(args.catalog).read_text())
    backend = MockBackend(catalog)
    client = ProviderClient(args.bus, catalog, backend)
    server = grpc.aio.server()
    mrpc.add_MockControlServicer_to_server(MockControl(backend), server)
    if server.add_insecure_port(args.listen) == 0:
        raise RuntimeError('mock API bind failed')
    await server.start()
    try:
        await client.run()
    finally:
        if backend.scenario_task:
            backend.scenario_task.cancel()
        await server.stop(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--bus', default='protobus-sim:55600')
    parser.add_argument('--listen', default='0.0.0.0:55601')
    asyncio.run(serve(parser.parse_args()))


if __name__ == '__main__':
    main()
