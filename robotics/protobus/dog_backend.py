"""Actual dog ROS backend for the shared fenced provider transport."""
import asyncio
import math
import time

from dog_protocol import motion_result, mission_result
from provider import ProviderClient, RejectedBeforeStart, scalar_from_wire
from identity import source_hash
from protobus.v1 import protobus_pb2 as pb


class DogProvider(ProviderClient):
    async def session(self):
        await self.backend.link.wait_ready(3600)
        return await super().session()


class DogBackend:
    def target_context(self,session):
        frame=self.link.protocol.require_frame(time.monotonic_ns())
        if not isinstance(frame.get('map_generation'),str) or not 1<=len(frame['map_generation'])<=256:
            raise ValueError('current map generation required')
        return pb.TargetContext(kind=pb.ROS_SIM,mapping_hash=self.engine.profile_hash,
            adapter_source_hash=source_hash(),source_epoch=self.link.protocol.source_epoch,
            brain_boot_id=frame['boot_id'],scene_epoch=frame['scene_epoch'],config_hash=frame['config_hash'],
            scene_id=frame['scene_id'],map_generation=frame['map_generation'],
            remote_arm_authorized=self.link.authorize_sim_arm)

    def __init__(self, catalog, engine, link, routes=None):
        self.catalog, self.engine, self.link = catalog, engine, link
        self.client = None
        self.target_value = None
        self.target_deadline = 0
        self.stop_request = None
        self.stop_error = None
        self.snapshot = {}
        self.capture_received = {}
        self.tasks = []
        self.claiming = False
        self.releasing_authority=False
        self.claimed_map = None
        self.link.on_epoch = self.epoch_changed
        self.routes = routes or {}

    def epoch_changed(self, _):
        self.target_value = None
        self.claimed_map = None
        if self.client:
            self.client.restart.set()

    def values(self):
        self.snapshot = dict(self.engine.observations)
        self.capture_received = dict(self.engine.last_sent)
        return {path: item.value for path, item in self.snapshot.items()}

    def quality(self, path):
        item = self.snapshot.get(path)
        if not item:
            return pb.NONE
        maximum = self.catalog['nodes'][path].get('maxAgeMs', 0)
        if item.quality == pb.OK and maximum and time.monotonic_ns()-self.capture_received[path] >= maximum*1_000_000:
            return pb.STALE
        return item.quality

    def sample_metadata(self, path):
        item = self.snapshot[path]
        return dict(source_time_ns=item.source_time_ns, source_clock=item.source_clock,
                    source_epoch=item.source_epoch)

    def controller(self, operation='command'):
        guard = self.client.guard
        if not guard or not self.client.connected.is_set() or guard.fence <= guard.invalid_through:
            raise RejectedBeforeStart('provider authority unavailable')
        frame=self.link.protocol.require_frame(time.monotonic_ns())
        if operation in ('command','renew') and self.claimed_map!=(frame.get('scene_id'),frame.get('map_generation')):
            raise RejectedBeforeStart('current map differs from explicit authority claim')
        return self.link.protocol.controller(guard.session, time.monotonic_ns(), guard.lease_deadline, operation)

    async def call(self, action, controller=None, **fields):
        request = self.link.send(action, controller, **fields)
        ack = await self.link.response(request)
        if not ack['accepted']:
            raise RejectedBeforeStart('Brain rejected before admission: '+ack.get('reason','unknown'))
        return request, ack

    async def claim(self):
        if self.link.protocol.owns():
            return
        self.claiming = True
        try:
            packet = self.controller('claim')
            _, ack = await self.call('authority_claim', packet)
            self.link.protocol.accept_claim(packet, ack)
            await self.link.wait(self.link.protocol.owns, .3)
            frame = self.link.protocol.require_frame(time.monotonic_ns())
            self.claimed_map = (frame.get('scene_id'), frame.get('map_generation'))
        finally:
            self.claiming = False

    def target(self, path, value, deadline):
        if path != 'Robot.Motion.Velocity':
            raise ValueError('unsupported ROS target')
        fields = self.catalog['nodes'][path]['fields']
        self.target_value = {key: scalar_from_wire(item, fields[key]) for key,item in value.fields.items()}
        self.target_deadline = deadline

    async def apply_target(self,path,value,deadline):
        frame=self.link.protocol.require_frame(time.monotonic_ns())
        epoch=self.link.protocol.source_epoch
        if self.claimed_map is not None and self.claimed_map!=(frame.get('scene_id'),frame.get('map_generation')):
            raise ConnectionError('map changed before target application')
        if deadline and (frame['mode']!='MANUAL' or frame.get('active_motion_id')):
            raise RejectedBeforeStart('velocity admission requires MANUAL and free body')
        self.target(path,value,deadline)
        if not deadline and frame['mode'] in ('DISARMED','SAFE_STOP'):
            await self.link.wait(lambda:self.link.protocol.source_epoch==epoch
                and self.link.protocol.brain.get('safe_command')==[0.,0.]
                and self.link.protocol.brain.get('active_motion_id') is None,.3)
            return
        packet=self.controller()
        if deadline:packet['valid_until_monotonic_ns']=min(packet['valid_until_monotonic_ns'],deadline)
        request,_=await self.call('manual',packet,linear=self.target_value['LinearX'],angular=self.target_value['AngularZ'])
        if not deadline:
            def released():
                current=self.link.protocol.require_frame(time.monotonic_ns())
                if self.link.protocol.source_epoch!=epoch:raise ConnectionError('source changed before release')
                if self.claimed_map!=(current.get('scene_id'),current.get('map_generation')):
                    raise ConnectionError('map changed before release confirmation')
                return (current['issued_at_ns']>=request.payload['issued_at_ns'] and current['mode']=='MANUAL'
                    and current.get('safe_command')==[0.,0.] and current.get('active_motion_id') is None)
            await self.link.wait(released,2)

    def request_stop(self):
        self.target_value = None
        self.target_deadline = 0
        if (self.stop_request is None or self.stop_request.future.done()
                or self.stop_request.source_epoch != self.link.protocol.source_epoch):
            self.stop_request = None
            try:
                self.stop_request = self.link.send('stop')
                self.stop_error = None
            except Exception as error:
                self.stop_error = str(error)
        self.link.protocol.clear_grant()

    def lost(self, reason):
        owned = bool(self.link.protocol.grant_id)
        self.target_value = None
        self.target_deadline = 0
        self.claimed_map = None
        if owned:
            try:
                self.request_stop()
            except Exception:
                pass  # Brain's independent absolute authority deadline remains active.
        self.link.protocol.clear_grant()

    async def stop(self):
        self.request_stop()
        request = self.stop_request
        if request is None:
            raise ConnectionError('ROS STOP not dispatched: '+str(self.stop_error))
        ack = await self.link.response(request)
        if not ack['accepted']:
            raise ConnectionError('Brain did not admit STOP')
        epoch = request.source_epoch
        await self.link.wait(lambda: self.link.protocol.source_epoch != epoch or (
            self.link.protocol.brain['mode'] in ('SAFE_STOP','DISARMED')
            and self.link.protocol.brain.get('active_motion_id') is None
            and self.link.protocol.brain.get('safe_command') == [0.,0.]), 20)
        if self.link.protocol.source_epoch != epoch:
            raise ConnectionError('source changed before physical STOP confirmation')
        self.stop_request = None

    async def renew_loop(self):
        while True:
            await asyncio.sleep(.1)
            if not self.link.protocol.grant_id or self.claiming or self.releasing_authority:
                continue
            try:
                frame = self.link.protocol.require_frame(time.monotonic_ns())
                if self.claimed_map != (frame.get('scene_id'), frame.get('map_generation')):
                    raise ConnectionError('map identity changed during authority grant')
                packet = self.controller('renew')
                _, ack = await self.call('authority_renew', packet)
                self.link.protocol.accept_renew(packet, ack)
            except asyncio.CancelledError:
                raise
            except Exception:
                if self.releasing_authority or not self.link.protocol.grant_id:continue
                self.lost('AUTHORITY_RENEW_FAILED')
                if self.client:
                    self.client.restart.set()

    async def manual_loop(self):
        next_tick = time.monotonic()
        while True:
            next_tick += .05
            await asyncio.sleep(max(0, next_tick-time.monotonic()))
            if next_tick < time.monotonic()-.1:
                next_tick = time.monotonic()
            value = self.target_value
            if value is None:
                continue
            try:
                if self.target_deadline and time.monotonic_ns() >= self.target_deadline:
                    self.target_value = None
                    self.request_stop()
                    continue
                packet = self.controller()
                if self.target_deadline:
                    packet['valid_until_monotonic_ns'] = min(packet['valid_until_monotonic_ns'], self.target_deadline)
                await self.call('manual', packet, linear=value['LinearX'], angular=value['AngularZ'])
                if not self.target_deadline:
                    self.target_value = None
            except asyncio.CancelledError:
                raise
            except Exception:
                self.lost('MANUAL_FAILED')
                if self.client:
                    self.client.restart.set()

    async def cancel_body_without_revoke(self,action,request,frame,execution_id):
        protocol=self.link.protocol
        def valid():
            if (not self.client or self.client.cancel_causes.get(execution_id)!='USER_CANCEL'
                    or not self.link.ready() or protocol.source_epoch!=request.source_epoch
                    or not protocol.owns()):raise ConnectionError('normal cancellation authority lost or escalated')
            current=protocol.require_frame(time.monotonic_ns())
            if self.claimed_map!=(current.get('scene_id'),current.get('map_generation')):
                raise ConnectionError('map changed during cancellation')
            self.controller() # Prove current fence and absolute grant validity.
            return current
        current=valid()
        if action=='motion':
            if current.get('active_motion_id')!=request.payload['request_id']:
                await self.link.wait(lambda:valid().get('active_motion_id')==request.payload['request_id'],.3)
            cancellation='motion_cancel'
        elif action in ('goal','route'):
            if current.get('mission_id')!=request.payload['request_id']:
                raise ConnectionError('original navigation identity unavailable for cancellation')
            cancellation='cancel'
        else:raise ConnectionError('normal body cancellation is not supported for this operation')
        await self.call(cancellation,self.controller())
        def recovered():
            current=valid()
            phase=(motion_result(self.link.motion,request.payload,frame['scene_epoch']) if action=='motion'
                else mission_result(current,request.payload,frame['boot_id'],frame['scene_epoch']))
            return (phase in ('CANCELLED','SUCCEEDED','FAILED','REJECTED') and current['mode']=='MANUAL'
                and current.get('active_motion_id') is None and current.get('safe_command')==[0.,0.])
        await self.link.wait(recovered,20)

    async def command(self, path, args, progress,*,execution_id=None):
        protocol = self.link.protocol
        frame = protocol.require_frame(time.monotonic_ns())
        if path == 'Robot.Safety.Arm':
            if not self.link.authorize_sim_arm:
                raise RejectedBeforeStart('remote Arm not authorized for this SIM profile')
            await self.claim()
        mapping = self.engine.profile['commands'].get(path)
        if not mapping:
            raise RejectedBeforeStart('command not mapped')
        action = mapping['action']
        fields = {}
        if action == 'motion':
            if frame['mode'] != 'MANUAL':
                raise RejectedBeforeStart('motion requires MANUAL')
            steady_since = None
            def standing():
                nonlocal steady_since
                state = self.link.sim or {}
                if (time.monotonic_ns()-self.link.sim_received_ns > 200_000_000
                        or state.get('scene_epoch') != frame['scene_epoch']
                        or state.get('config_hash') != frame['config_hash']):
                    steady_since = None
                    return False
                velocity, angular, forces = state.get('velocity',[]), state.get('angular_velocity',[]), state.get('foot_forces_n',[])
                joints, position = state.get('joint_velocities',[]), state.get('position',[])
                valid = (len(velocity) == len(angular) == 3 and len(forces) == 4
                    and len(joints) == 12 and len(position) == 3
                    and all(type(value) in (int,float) and math.isfinite(value) for value in velocity+angular+forces+joints+position)
                    and math.sqrt(sum(value*value for value in velocity)) < .06
                    and math.sqrt(sum(value*value for value in angular)) < .12
                    and math.sqrt(sum(value*value for value in joints)) < 1.
                    and position[2] > .24
                    and state.get('upright',0) > .98 and all(force > 5 for force in forces)
                    and not state.get('paused',True) and not state.get('fallen',True))
                if not valid:
                    steady_since = None
                    return False
                steady_since = steady_since or time.monotonic()
                return time.monotonic()-steady_since >= .5
            try:
                # The qualified locomotion controller needs 2 s of zero input
                # before blending into its standing hold. Observe completion;
                # a low base velocity alone does not imply stationary joints.
                await self.link.wait(standing, 5)
            except asyncio.CancelledError:
                return pb.CANCELLED,'no physical motion was dispatched',True
            except ConnectionError as error:
                raise RejectedBeforeStart('stationary four-foot stance not observed before dispatch') from error
            fields['motion_name'] = mapping['enumMap'][args['Name']]
        elif action == 'goal':
            if self.claimed_map != (frame.get('scene_id'), frame.get('map_generation')):
                raise RejectedBeforeStart('navigation map differs from explicit authority claim')
            fields.update(goal=[args['X'],args['Y']], goal_frame='map', map_generation=frame['map_generation'])
        elif action == 'route':
            if self.claimed_map != (frame.get('scene_id'), frame.get('map_generation')):
                raise RejectedBeforeStart('navigation map differs from explicit authority claim')
            route = self.routes.get(args['RouteId'])
            if (not isinstance(route,dict) or route.get('frame') != 'map'
                    or route.get('map_generation') != frame['map_generation']
                    or route.get('scene_id') != frame.get('scene_id')):
                raise RejectedBeforeStart('route must be configured and bound to the current map/scene')
            points = route.get('waypoints')
            if (not isinstance(points,list) or not 1 <= len(points) <= 20
                    or any(not isinstance(point,list) or len(point) != 2 or any(
                        type(value) not in (int,float) or not math.isfinite(value) for value in point)
                        for point in points)):
                raise RejectedBeforeStart('route requires 1..20 finite map-frame waypoints')
            fields.update(waypoints=[list(point) for point in points],goal_frame='map',map_generation=frame['map_generation'])
        controller = None if action in ('stop','disarm') else self.controller(
            'reset' if action == 'reset_stop' and not protocol.owns() else 'command')
        request = None
        try:
            self.releasing_authority=action in ('disarm','stop')
            request = self.link.send(action, controller, **fields)
            ack = await self.link.response(request)
            if not ack['accepted']:
                raise RejectedBeforeStart('Brain rejected: '+ack.get('reason','unknown'))
            if action in ('disarm','stop'):protocol.clear_grant()
            await progress(pb.ACCEPTED, 'actual Brain admission')
            epoch = request.source_epoch
            running = False
            while True:
                if protocol.source_epoch != epoch or not self.link.ready():
                    raise ConnectionError('dog source lost during command')
                current = protocol.brain
                phase = None
                if action == 'motion':
                    motion = self.link.motion or {}
                    if not running and motion.get('motion_id') == request.payload['request_id'] and motion.get('phase') in ('RUNNING','RECOVERING'):
                        await progress(pb.RUNNING, 'actual physical motion feedback')
                        running = True
                    phase = motion_result(self.link.motion, request.payload, frame['scene_epoch'])
                    if current.get('active_motion_id') is not None:
                        phase = None
                elif action in ('goal','route'):
                    if not running and current.get('mission_id') == request.payload['request_id'] and current.get('mission') == 'RUNNING':
                        await progress(pb.RUNNING, 'actual navigation mission feedback')
                        running = True
                    phase = mission_result(current, request.payload, frame['boot_id'], frame['scene_epoch'])
                else:
                    expected = {'arm':'MANUAL','disarm':'DISARMED','reset_stop':'DISARMED','stop':'SAFE_STOP'}[action]
                    if current['mode'] == expected and current.get('active_motion_id') is None:
                        phase = 'SUCCEEDED'
                if phase:
                    if action in ('disarm','stop','reset_stop'):
                        protocol.clear_grant()
                        self.stop_request = None
                    # Brain ACK already admitted the command. A later physics
                    # rejection is a confirmed execution failure, not a second
                    # pre-admission REJECTED transition.
                    reason = 'actual ROS terminal state'
                    if phase == 'REJECTED':
                        phase = 'FAILED'
                        reason = 'physical admission rejected: '+str((self.link.motion or {}).get('reason','unknown'))
                    return getattr(pb, phase), reason, True
                await asyncio.sleep(.02)
        except asyncio.CancelledError:
            if request is None:
                raise
            if self.client and self.client.cancel_causes.get(execution_id)=='USER_CANCEL':
                try:
                    await self.cancel_body_without_revoke(action,request,frame,execution_id)
                    return pb.CANCELLED,'actual correlated recovery; current grant retained',True
                except Exception:pass # Escalate every ambiguous/lost recovery to Stop.
            self.request_stop()
            try:
                await self.stop()
                return pb.CANCELLED, 'actual ROS standing/stop recovery observed', True
            except Exception:
                return pb.CANCELLED, 'physical cancellation unconfirmed', False
        finally:self.releasing_authority=False

    async def start(self):
        self.tasks = [asyncio.create_task(self.renew_loop()), asyncio.create_task(self.manual_loop())]

    async def close(self):
        self.lost('BACKEND_CLOSED')
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
