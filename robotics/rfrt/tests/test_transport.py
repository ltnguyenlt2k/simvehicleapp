"""Runtime unit tests with an explicit fake typed server over real gRPC sockets."""
import json
from pathlib import Path
import time
import unittest

import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from rfrt.core import AuthorityLost
from rfrt.transport import BusTransport,TargetBinding
from rfrt.values import UNKNOWN


class FakeServer(rpc.BusServicer):
    def __init__(self,catalog):
        self.descriptor=pb.Descriptor(robot_id='dog1',profile_id='dog-go2-sim',catalog_hash=catalog['catalogHash'],
            broker_epoch='broker1',provider_session='provider1',provider_online=True,backend='SIM',host_clock_id='unit-host',
            protocol_version='1.6',audit_ok=True,target_context=pb.TargetContext(kind=pb.KINEMATIC_MOCK,
            mapping_hash='sha256:'+'a'*64,adapter_source_hash='sha256:'+'b'*64,source_epoch='provider1'))
        self.quality=pb.OK;self.epoch=None;self.source_age=0;self.wrong_type=False
    async def Describe(self,request,context):return self.descriptor
    async def Get(self,request,context):
        now=time.monotonic_ns()
        result=pb.Samples(broker_epoch=self.descriptor.broker_epoch,provider_session=self.descriptor.provider_session,
            samples=[pb.Sample(path=path,quality=self.quality,sequence=1,source_clock='MONOTONIC',
            source_epoch=self.epoch or self.descriptor.provider_session,source_time_ns=now-self.source_age,broker_time_ns=now,
            value=pb.Value() if self.quality==pb.NONE else pb.Value(string_value='wrong') if self.wrong_type else pb.Value(bool_value=False))
            for path in request.paths])
        for item in result.samples:
            if '.Status.' in item.path:
                item.source_epoch=self.descriptor.broker_epoch;item.source_time_ns=now-10_000_000_000
                item.broker_time_ns=item.source_time_ns;item.value.CopyFrom(pb.Value(string_value='RUNNING'))
        return result


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        self.fake=FakeServer(self.catalog);self.server=grpc.aio.server()
        rpc.add_BusServicer_to_server(self.fake,self.server)
        port=self.server.add_insecure_port('127.0.0.1:0');await self.server.start()
        self.client=BusTransport(f'127.0.0.1:{port}',self.catalog,TargetBinding.record(self.fake.descriptor),'unit-host')
        await self.client.open()
    async def asyncTearDown(self):await self.client.close();await self.server.stop(0)

    async def test_explicit_binding_and_fresh_false_are_not_missing_data(self):
        result=await self.client.fetch(['Robot.Safety.IsArmed'])
        self.assertIs(result['Robot.Safety.IsArmed'],False)
        self.fake.quality=pb.NONE
        self.assertIs((await self.client.fetch(['Robot.Safety.IsArmed']))['Robot.Safety.IsArmed'],UNKNOWN)

    async def test_same_mock_mapping_can_start_new_session_but_active_run_cannot_resume(self):
        expected=self.client.binding
        self.fake.descriptor.provider_session='provider2';self.fake.descriptor.target_context.source_epoch='provider2'
        self.assertEqual(expected,TargetBinding.record(self.fake.descriptor))
        with self.assertRaises(AuthorityLost):await self.client.refresh_identity()
        self.fake.descriptor.provider_session='provider1';self.fake.descriptor.target_context.source_epoch='provider1'
        with self.assertRaises(AuthorityLost):await self.client.fetch(['Robot.Safety.IsArmed'])
        with self.assertRaises(AuthorityLost):await self.client.open()

    async def test_mapping_source_and_broker_changes_invalidate_existing_run(self):
        self.fake.descriptor.target_context.mapping_hash='sha256:'+'c'*64
        with self.assertRaises(AuthorityLost):await self.client.refresh_identity()
        self.assertTrue(self.client.fault)

    async def test_old_capture_does_not_become_fresh_from_a_new_broker_receipt(self):
        self.fake.source_age=400_000_000
        self.assertIs((await self.client.fetch(['Robot.Safety.IsArmed']))['Robot.Safety.IsArmed'],UNKNOWN)

    async def test_old_epoch_cannot_be_assigned_to_current_session(self):
        self.fake.epoch='old'
        with self.assertRaises(AuthorityLost):await self.client.fetch(['Robot.Safety.IsArmed'])

    async def test_wrong_wire_type_fails_instead_of_coercing_to_false(self):
        self.fake.wrong_type=True
        with self.assertRaises(AuthorityLost):await self.client.fetch(['Robot.Safety.IsArmed'])

    async def test_versioned_target_record_is_closed_and_excludes_mock_session(self):
        record=self.client.binding.record_json()
        self.assertNotIn('sourceEpoch',record['context'])
        self.assertEqual(TargetBinding.from_json(record),self.client.binding)
        record['unreviewed']='wrong'
        with self.assertRaises(Exception):TargetBinding.from_json(record)

    async def test_broker_known_command_status_is_not_an_expiring_sensor_capture(self):
        value=await self.client.fetch(['Robot.Motion.Perform.Status.Phase'])
        self.assertEqual(value['Robot.Motion.Perform.Status.Phase'],'RUNNING')
