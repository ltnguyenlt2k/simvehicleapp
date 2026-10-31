"""Backend policy unit fixtures. Actual DDS/physics probes are separate gates."""
import asyncio
import json
from pathlib import Path
import time
from types import SimpleNamespace
import unittest

from broker import load_catalog
from dog_backend import DogBackend
from mapping import MappingEngine, Observation
from provider import RejectedBeforeStart
from protobus.v1 import protobus_pb2 as pb


class FakeLink:
    def __init__(self):
        self.authorize_sim_arm = False
        self.ros_now=200_000_000
        self.sent = []
        self.fail_send = False
        self.frame = dict(schema=1, source='SIM', config_hash='a'*64, boot_id='brain',
            scene_epoch='scene', scene_id='courtyard', map_generation='map-1', mode='MANUAL',
            issued_at_ns=200, active_motion_id=None, safe_command=[0.,0.], mission='SUCCEEDED')
        self.protocol = SimpleNamespace(source_epoch='epoch', brain=self.frame, grant_id='grant',
            require_frame=lambda _:self.frame, owns=lambda:True, clear_grant=self.clear)
        self.sim = dict(scene_epoch='scene',config_hash='a'*64,velocity=[0.,0.,0.],
            joint_velocities=[0.]*12,position=[0.,0.,.3],
            angular_velocity=[0.,0.,0.],foot_forces_n=[20.,20.,20.,20.],upright=1.,paused=False,fallen=False)
        self.sim_received_ns = time.monotonic_ns()
        self.motion = None

    def clear(self): self.protocol.grant_id = ''
    def ready(self): return True
    def ros_time_ns(self):return self.ros_now

    def send(self, action, controller=None, **fields):
        if self.fail_send: raise ConnectionError('actual dispatch unavailable in unit fixture')
        payload = dict(schema=1,source='SIM',config_hash='a'*64,request_id='request',issued_at_ns=100,action=action,**fields)
        self.sent.append(payload)
        future = asyncio.get_running_loop().create_future()
        future.set_result({'accepted':True})
        self.frame['mission_id'] = 'request'
        if action == 'motion':
            self.motion = dict(schema=1,source='SIM',config_hash='a'*64,motion_id='request',
                scene_epoch='scene',issued_at_ns=200,phase='REJECTED',active=False,reason='physical stance rejection')
        return SimpleNamespace(payload=payload,source_epoch='epoch',future=future)

    async def response(self, request): return await request.future

    async def wait(self, predicate, timeout=3):
        end = time.monotonic()+timeout
        while time.monotonic()<end:
            self.sim_received_ns = time.monotonic_ns()
            if predicate(): return
            await asyncio.sleep(.01)
        raise ConnectionError('fixture feedback unavailable')


class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        profile = json.loads((Path(__file__).parents[1]/'profiles/dog-go2-sim/mapping.json').read_text())
        self.engine = MappingEngine(self.catalog,profile)
        self.link = FakeLink()
        self.backend = DogBackend(self.catalog,self.engine,self.link)
        self.backend.claimed_map = ('courtyard','map-1')
        self.backend.controller = lambda operation='command': {'unitFixture':operation}

    async def progress(self, phase, reason): self.phases.append(phase)

    async def test_stale_capture_remains_stale_across_provider_snapshot(self):
        path='Robot.Imu.AngularVelocity.X'
        self.engine.observations[path]=Observation(.2,pb.OK,123,'epoch','ROS_TIME')
        self.engine.last_sent[path]=time.monotonic_ns()-300_000_000
        self.assertEqual(self.backend.values()[path],.2)
        self.assertEqual(self.backend.quality(path),pb.STALE)
        self.assertEqual(self.backend.sample_metadata(path)['source_time_ns'],123)

    async def test_recent_receipt_cannot_refresh_an_old_ros_capture(self):
        path='Robot.Imu.AngularVelocity.X'
        self.engine.observations[path]=Observation(.2,pb.OK,1,'epoch','ROS_TIME')
        self.engine.last_sent[path]=time.monotonic_ns();self.link.ros_now=500_000_000
        self.backend.values();self.assertEqual(self.backend.quality(path),pb.STALE)

    async def test_future_missing_clock_old_epoch_and_wrong_domain_stay_unknown(self):
        path='Robot.Imu.AngularVelocity.X'
        for stamp,epoch,domain,clock in [(300_000_000,'epoch','ROS_TIME',200_000_000),(100,'epoch','ROS_TIME',None),(100,'old','ROS_TIME',200),(100,'epoch','MONOTONIC',200)]:
            self.engine.observations[path]=Observation(.2,pb.OK,stamp,epoch,domain)
            self.engine.last_sent[path]=time.monotonic_ns();self.link.ros_now=clock
            self.backend.values();self.assertEqual(self.backend.quality(path),pb.NONE)

    async def test_actual_ros_age_and_host_receipt_are_both_fresh(self):
        path='Robot.Imu.AngularVelocity.X'
        self.engine.observations[path]=Observation(.2,pb.OK,100_000_000,'epoch','ROS_TIME')
        self.engine.last_sent[path]=time.monotonic_ns();self.link.ros_now=200_000_000
        self.backend.values();self.assertEqual(self.backend.quality(path),pb.OK)

    async def test_target_context_preserves_actual_string_map_and_effective_authorization(self):
        context=self.backend.target_context('transport-session')
        self.assertEqual(context.kind,pb.ROS_SIM)
        self.assertEqual(context.mapping_hash,self.engine.profile_hash)
        self.assertEqual(context.map_generation,'map-1')
        self.assertEqual(context.source_epoch,'epoch')
        self.assertFalse(context.remote_arm_authorized)
        self.link.frame['map_generation']='scene/new-map'
        self.assertNotEqual(self.backend.target_context('transport-session'),context)
        self.link.frame['map_generation']=1
        with self.assertRaises(ValueError):self.backend.target_context('transport-session')

    def velocity(self,linear=0.):
        return pb.Object(fields={'LinearX':pb.Value(float64_value=linear),'AngularZ':pb.Value(float64_value=0.)})

    async def test_target_admission_dispatches_actual_manual_request_before_return(self):
        self.backend.controller=lambda operation='command':{'valid_until_monotonic_ns':time.monotonic_ns()+500_000_000}
        await self.backend.apply_target('Robot.Motion.Velocity',self.velocity(.2),time.monotonic_ns()+200_000_000)
        self.assertEqual(self.link.sent[-1]['action'],'manual')
        self.assertEqual(self.link.sent[-1]['linear'],.2)

    async def test_release_waits_for_zero_observation_instead_of_ack_alone(self):
        self.link.frame['safe_command']=[.2,0.]
        task=asyncio.create_task(self.backend.apply_target('Robot.Motion.Velocity',self.velocity(),0))
        await asyncio.sleep(.02);self.assertFalse(task.done())
        self.link.frame['safe_command']=[0.,0.]
        await asyncio.wait_for(task,.1)

    async def test_changed_source_cannot_confirm_old_release(self):
        self.link.frame['safe_command']=[.2,0.]
        task=asyncio.create_task(self.backend.apply_target('Robot.Motion.Velocity',self.velocity(),0))
        await asyncio.sleep(.02);self.link.protocol.source_epoch='changed'
        self.link.frame['safe_command']=[0.,0.]
        with self.assertRaises(ConnectionError):await task

    async def test_disarm_admission_does_not_race_authority_renewal(self):
        gate=asyncio.Event();self.phases=[]
        self.backend.client=SimpleNamespace(restart=asyncio.Event())
        original=self.link.response
        async def delayed(request):await gate.wait();return await original(request)
        self.link.response=delayed
        renewal=asyncio.create_task(self.backend.renew_loop())
        command=asyncio.create_task(self.backend.command('Robot.Safety.Disarm',{},self.progress))
        try:
            await asyncio.sleep(.12)
            self.assertTrue(self.backend.releasing_authority)
            self.assertFalse(self.backend.client.restart.is_set())
            gate.set();await asyncio.sleep(.02)
            self.assertEqual(self.link.protocol.grant_id,'')
            self.link.frame['mode']='DISARMED'
            result=await asyncio.wait_for(command,.2)
            self.assertEqual(result[0],pb.SUCCEEDED)
            self.assertFalse(self.backend.releasing_authority)
        finally:
            gate.set();renewal.cancel();command.cancel()
            await asyncio.gather(renewal,command,return_exceptions=True)

    async def test_normal_motion_cancel_waits_original_recovery_and_retains_grant(self):
        self.backend.client=SimpleNamespace(cancel_causes={'exec':'USER_CANCEL'})
        self.link.frame['active_motion_id']='original';self.link.frame['safe_command']=[0.,0.]
        request=SimpleNamespace(source_epoch='epoch',payload=dict(request_id='original',config_hash='a'*64,issued_at_ns=100))
        task=asyncio.create_task(self.backend.cancel_body_without_revoke('motion',request,self.link.frame.copy(),'exec'))
        await asyncio.sleep(.02);self.assertFalse(task.done())
        self.assertEqual(self.link.sent[-1]['action'],'motion_cancel')
        self.link.frame['active_motion_id']=None
        self.link.motion=dict(schema=1,source='SIM',config_hash='a'*64,scene_epoch='scene',
            issued_at_ns=200,motion_id='original',phase='CANCELLED',active=False)
        await asyncio.wait_for(task,.1)
        self.assertEqual(self.link.protocol.grant_id,'grant')
        self.assertFalse(any(item['action']=='stop' for item in self.link.sent))

    async def test_cancel_timeout_escalation_cannot_claim_normal_handover(self):
        self.backend.client=SimpleNamespace(cancel_causes={'exec':'USER_CANCEL'})
        self.link.frame['active_motion_id']='original'
        request=SimpleNamespace(source_epoch='epoch',payload=dict(request_id='original',config_hash='a'*64,issued_at_ns=100))
        task=asyncio.create_task(self.backend.cancel_body_without_revoke('motion',request,self.link.frame.copy(),'exec'))
        await asyncio.sleep(.02);self.backend.client.cancel_causes['exec']='PB_TIMEOUT'
        with self.assertRaises(ConnectionError):await task

    async def test_cancel_during_stance_wait_confirms_no_motion_was_dispatched(self):
        entered=asyncio.Event();self.phases=[]
        async def pending(predicate,timeout):entered.set();await asyncio.sleep(1)
        self.link.wait=pending
        task=asyncio.create_task(self.backend.command('Robot.Motion.Perform',{'Name':'BOW'},self.progress))
        await entered.wait();task.cancel()
        result=await task
        self.assertEqual(result[0],pb.CANCELLED);self.assertTrue(result[2])
        self.assertEqual(self.link.sent,[])
        self.assertEqual(self.link.protocol.grant_id,'grant')

    async def test_every_controller_packet_rechecks_commissioned_map(self):
        connected=asyncio.Event();connected.set()
        self.backend.client=SimpleNamespace(connected=connected,guard=SimpleNamespace(fence=1,invalid_through=0,
            session='session',lease_deadline=time.monotonic_ns()+500_000_000))
        self.link.protocol.controller=lambda *args: {'unitFixture':True}
        self.backend.controller=DogBackend.controller.__get__(self.backend)
        self.assertEqual(self.backend.controller(),{'unitFixture':True})
        self.link.frame['map_generation']='changed'
        with self.assertRaises(RejectedBeforeStart):self.backend.controller()

    async def test_unavailable_stop_dispatch_is_never_confirmed(self):
        self.link.fail_send=True
        self.backend.request_stop()
        self.assertIsNone(self.backend.stop_request)
        with self.assertRaises(ConnectionError): await self.backend.stop()

    async def test_downstream_rejection_after_ack_is_failed_not_illegal_rejected_transition(self):
        self.phases=[]
        result=await self.backend.command('Robot.Motion.Perform',{'Name':'BOW'},self.progress)
        self.assertEqual(result[0],pb.FAILED)
        self.assertTrue(result[2])
        self.assertEqual(self.phases,[pb.ACCEPTED])
        self.assertIn('physical stance rejection',result[1])

    async def test_route_requires_exact_map_and_scene_then_renders_waypoints(self):
        self.phases=[]
        with self.assertRaises(RejectedBeforeStart):
            await self.backend.command('Robot.Navigation.FollowRoute',{'RouteId':'missing'},self.progress)
        self.assertEqual(self.link.sent,[])
        route=dict(frame='map',map_generation='map-1',scene_id='courtyard',waypoints=[[.2,0.],[0.,0.]])
        self.backend.routes={'r1':route}
        result=await self.backend.command('Robot.Navigation.FollowRoute',{'RouteId':'r1'},self.progress)
        self.assertEqual(result[0],pb.SUCCEEDED)
        self.assertEqual(self.link.sent[-1]['waypoints'],route['waypoints'])
        route['map_generation']='old-map'
        with self.assertRaises(RejectedBeforeStart):
            await self.backend.command('Robot.Navigation.FollowRoute',{'RouteId':'r1'},self.progress)

    async def test_arm_default_is_disabled_before_any_ros_request(self):
        self.phases=[]
        with self.assertRaises(RejectedBeforeStart):
            await self.backend.command('Robot.Safety.Arm',{},self.progress)
        self.assertEqual(self.link.sent,[])

    async def test_navigation_cannot_reinterpret_coordinates_after_map_change(self):
        self.phases=[]
        self.link.frame['map_generation']='map-2'
        with self.assertRaises(RejectedBeforeStart):
            await self.backend.command('Robot.Navigation.GoTo',{'X':.2,'Y':0.},self.progress)
        self.assertEqual(self.link.sent,[])

    async def test_low_base_speed_does_not_hide_moving_joints_before_motion(self):
        self.phases=[]
        self.link.sim['joint_velocities']=[1.]*12
        async def observe(predicate, timeout):
            self.assertFalse(predicate())
            raise ConnectionError('no qualified standing capture')
        self.link.wait=observe
        with self.assertRaises(RejectedBeforeStart):
            await self.backend.command('Robot.Motion.Perform',{'Name':'BOW'},self.progress)
        self.assertEqual(self.link.sent,[])
