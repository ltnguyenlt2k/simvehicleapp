import asyncio
import json
from pathlib import Path
import stat
import sys
import tempfile

from test_broker_control import ControlFixture
from protobus.v1 import protobus_pb2 as pb


class CliTests(ControlFixture):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.directory = tempfile.TemporaryDirectory()
        self.file = Path(self.directory.name)/'lease.json'
        self.catalog_file = Path(self.directory.name)/'catalog.json'
        self.catalog_file.write_text(json.dumps(self.catalog))

    async def asyncTearDown(self):
        await super().asyncTearDown()
        self.directory.cleanup()

    async def cli(self, *args, expected=0):
        process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'pbctl',
            '--bus', self.address, '--catalog', str(self.catalog_file), '--lease-file', str(self.file),
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(process.communicate(), 5)
        self.assertEqual(process.returncode, expected, stderr.decode())
        return stdout.decode(), stderr.decode()

    async def test_help_describe_get_and_subscribe_use_actual_broker(self):
        stdout, _ = await self.cli('--help')
        self.assertIn('subscribe', stdout)
        stdout, _ = await self.cli('describe')
        self.assertEqual(json.loads(stdout)['backend'], 'SIM')
        stdout, _ = await self.cli('get', 'Robot.Signal.Speed')
        self.assertEqual(json.loads(stdout)['samples'][0]['quality'], 'NONE')
        stdout, _ = await self.cli('subscribe', 'Robot.Signal.Speed', '--count', '1')
        self.assertEqual(json.loads(stdout)['samples'][0]['path'], 'Robot.Signal.Speed')

    async def test_private_lease_file_set_renew_and_release(self):
        stdout, _ = await self.cli('lease', 'acquire')
        data = json.loads(self.file.read_text())
        self.assertNotIn(data['lease']['token'], stdout)
        self.assertEqual(stat.S_IMODE(self.file.stat().st_mode), 0o600)
        await self.next_kind(self.control, pb.LEASE_UPDATE)
        await self.cli('lease', 'renew')
        await self.next_kind(self.control, pb.LEASE_UPDATE)
        await self.cli('set', 'Robot.Motion.Velocity', '--value', '{"LinearX":0.25}')
        target = await self.next_kind(self.control, pb.SET_TARGET)
        self.assertEqual(target.value.fields['LinearX'].float64_value, .25)
        await self.cli('set', 'Robot.Motion.Velocity', '--release')
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.value.fields['LinearX'].float64_value, 0)
        await self.cli('lease', 'release')
        self.assertFalse(self.file.exists())

    async def test_errors_are_nonzero_and_do_not_overwrite_an_existing_lease(self):
        await self.cli('lease', 'acquire')
        original = self.file.read_text()
        await self.cli('lease', 'acquire', expected=2)
        self.assertEqual(self.file.read_text(), original)
        await self.cli('set', 'Robot.Motion.Velocity', '--value', '{"LinearX":9}', expected=2)
        self.assertFalse(self.broker.targets)

    async def reply(self, dispatch, phase, confirmed=False):
        ack = await self.packet(pb.ProviderPacket(command=pb.CommandUpdate(
            execution_id=dispatch.execution_id, path=dispatch.path,
            provider_session=self.hello.session, phase=phase, physical_confirmed=confirmed)))
        self.assertTrue(ack.ok, ack)

    async def test_invoke_exit_status_follows_provider_result(self):
        await self.cli('lease', 'acquire')
        for terminal, code in ((pb.SUCCEEDED, 0), (pb.FAILED, 3)):
            task = asyncio.create_task(self.cli('invoke', 'Robot.Motion.Perform',
                '--args', '{"Name":"BOW"}', '--timeout', '1000', expected=code))
            dispatch = await self.next_kind(self.control, pb.INVOKE)
            await self.reply(dispatch, pb.ACCEPTED)
            await self.reply(dispatch, terminal, True)
            stdout, _ = await task
            updates = [json.loads(line) for line in stdout.splitlines()]
            self.assertEqual(updates[-1]['phase'], pb.Phase.Name(terminal))
            self.assertTrue(updates[-1]['physicalConfirmed'])

    async def test_cancel_and_stop_use_safety_and_confirmed_feedback(self):
        await self.cli('lease', 'acquire')
        task = asyncio.create_task(self.cli('invoke', 'Robot.Motion.Perform',
            '--args', '{"Name":"BOW"}', '--timeout', '1000', expected=3))
        dispatch = await self.next_kind(self.control, pb.INVOKE)
        await self.reply(dispatch, pb.ACCEPTED)
        await self.cli('cancel', dispatch.execution_id)
        cancel = await self.next_kind(self.safety, pb.CANCEL)
        self.assertEqual(cancel.execution_id, dispatch.execution_id)
        await self.reply(dispatch, pb.CANCELLED, True)
        stdout, _ = await task
        self.assertEqual(json.loads(stdout.splitlines()[-1])['phase'], 'CANCELLED')
        stop_task = asyncio.create_task(self.cli('stop'))
        stop = await self.next_kind(self.safety, pb.STOP)
        await self.reply(stop, pb.ACCEPTED)
        await self.reply(stop, pb.SUCCEEDED, True)
        stdout, _ = await stop_task
        self.assertTrue(json.loads(stdout)['robotConfirmed'])
        receipt=json.loads(stdout)
        stdout,_=await self.cli('inspect',receipt['executionId'],'--epoch',receipt['brokerEpoch'])
        state=json.loads(stdout)
        self.assertTrue(state['physicalReleased'])
        self.assertEqual(state['physicalPhase'],'SUCCEEDED')
        self.assertEqual(state['providerSession'],self.hello.session)
        self.assertIsNone(self.broker.lease)
        await self.cli('inspect',receipt['executionId'],'--epoch','old',expected=2)
