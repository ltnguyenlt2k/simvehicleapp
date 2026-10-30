import hashlib
from pathlib import Path

import grpc
from identity import data_hash,source_hash
from protobus.v1 import protobus_pb2 as pb
from test_broker_data import BrokerFixture


class TargetContextTests(BrokerFixture):
    async def test_ros_descriptor_preserves_exact_wire_context_and_sample_session(self):
        context=pb.TargetContext(kind=pb.ROS_SIM,mapping_hash='sha256:'+'a'*64,
            adapter_source_hash='sha256:'+'b'*64,source_epoch='source',brain_boot_id='brain',
            scene_epoch='scene',config_hash='c'*64,scene_id='courtyard',map_generation='scene/map-generation',
            remote_arm_authorized=False)
        await self.attach(self.make_hello(target_context=context))
        descriptor=await self.bus.Describe(pb.Empty())
        self.assertEqual(descriptor.target_context,context)
        self.assertEqual(descriptor.provider_session,self.hello.session)
        self.assertFalse(descriptor.target_context.remote_arm_authorized)
        batch=await self.bus.Get(self.query('Robot.Signal.Speed'))
        self.assertEqual(batch.provider_session,self.hello.session)
        self.assertEqual(batch.samples[0].quality,pb.NONE,'metadata cannot fabricate a sensor capture')
        stream=self.bus.Subscribe(self.query('Robot.Signal.Speed'));self.calls.append(stream)
        self.assertEqual((await stream.read()).provider_session,self.hello.session)
        self.assertIsNone(self.broker.lease,'metadata reads cannot grant authority')

    async def test_missing_unknown_malformed_and_mock_physical_claims_rejected_over_grpc(self):
        good=self.make_hello().target_context
        cases=[pb.TargetContext(),pb.TargetContext(kind=99),
            pb.TargetContext(kind=pb.KINEMATIC_MOCK,mapping_hash='unmeasured',adapter_source_hash=good.adapter_source_hash,source_epoch='s'),
            pb.TargetContext(kind=pb.KINEMATIC_MOCK,mapping_hash=good.mapping_hash,adapter_source_hash=good.adapter_source_hash,source_epoch='s',brain_boot_id='fake'),
            pb.TargetContext(kind=pb.ROS_SIM,mapping_hash=good.mapping_hash,adapter_source_hash=good.adapter_source_hash,source_epoch='s')]
        for context in cases:
            with self.subTest(context=context):
                call=self.provider_stub.Attach();self.calls.append(call)
                await call.write(pb.ProviderPacket(hello=self.make_hello(target_context=context)))
                with self.assertRaises(grpc.aio.AioRpcError) as caught:await call.read()
                self.assertIn('PB_PROVIDER_MISMATCH',caught.exception.details())
                self.assertIsNone(self.broker.provider)
        self.assertIsNone(self.broker.lease)

    async def test_source_identity_is_measured_from_owned_code_locks_and_wire_bytes(self):
        root=Path(__file__).resolve().parents[1]
        names=[path.name for path in sorted(root.glob('*.py'))]+['requirements.txt','bridge-requirements.txt','bridge-build-requirements.txt','interface-source/manifest.json']
        actual={name:'sha256:'+hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names}
        for name in ('protobus/v1/protobus.proto','dog-control-authority.v1.json','units.v1.json'):
            actual['wire/'+name]='sha256:'+hashlib.sha256((Path('/contracts')/name).read_bytes()).hexdigest()
        self.assertEqual(source_hash(),data_hash(actual))
