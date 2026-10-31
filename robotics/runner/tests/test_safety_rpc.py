"""Actual gRPC safety-only fixture; no model/physics claim."""
import unittest
import grpc
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc
from service import RobotBus

class SafetyOnly(rpc.BusServicer):
    def __init__(self):self.confirmed=True;self.stops=0;self.describes=0
    async def Stop(self,request,context):
        self.stops+=1
        return pb.StopReply(requested=True,dispatched=True,robot_confirmed=self.confirmed,
            execution_id='unit-stop',broker_epoch='unit-epoch',provider_session='unit-provider')
    async def Describe(self,request,context):
        self.describes+=1
        await context.abort(grpc.StatusCode.UNAVAILABLE,'fixture provider/clock unavailable')

class SafetyRpcTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server=grpc.aio.server();self.fixture=SafetyOnly();rpc.add_BusServicer_to_server(self.fixture,self.server)
        port=self.server.add_insecure_port('127.0.0.1:0');await self.server.start()
        self.bus=RobotBus('sim');self.bus.address='127.0.0.1:'+str(port)
    async def asyncTearDown(self):await self.server.stop(0)
    async def test_stop_is_dispatched_without_readiness_clock_or_lease_precheck(self):
        result=await self.bus.stop()
        self.assertTrue(result['confirmed']);self.assertEqual(self.fixture.stops,1)
        self.assertEqual(self.fixture.describes,0)
    async def test_missing_confirmation_is_never_turned_into_success_on_provider_loss(self):
        self.fixture.confirmed=False
        result=await self.bus.stop()
        self.assertTrue(result['requested']);self.assertTrue(result['dispatched'])
        self.assertFalse(result['confirmed']);self.assertEqual(self.fixture.stops,1)
