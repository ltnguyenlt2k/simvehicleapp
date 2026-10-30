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
        self.engine.observations[path]=Observation(.2,pb.OK,123,'scene','ROS_TIME')
        self.engine.last_sent[path]=time.monotonic_ns()-300_000_000
        self.assertEqual(self.backend.values()[path],.2)
        self.assertEqual(self.backend.quality(path),pb.STALE)
        self.assertEqual(self.backend.sample_metadata(path)['source_time_ns'],123)

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
