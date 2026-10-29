"""Command lifecycle and bounded asynchronous audit for the broker asyncio loop."""
import asyncio
from collections import deque
import copy
from dataclasses import dataclass, field
import json
from pathlib import Path
import time
import uuid
from google.protobuf.json_format import MessageToDict

from protobus.v1 import protobus_pb2 as pb

TERMINAL = {pb.SUCCEEDED, pb.FAILED, pb.REJECTED, pb.CANCELLED, pb.TIMED_OUT}
TRANSITIONS = {
    pb.PENDING: {pb.ACCEPTED, pb.REJECTED, pb.FAILED, pb.CANCELLED, pb.TIMED_OUT},
    pb.ACCEPTED: {pb.RUNNING, pb.SUCCEEDED, pb.FAILED, pb.CANCELLED, pb.TIMED_OUT},
    pb.RUNNING: {pb.SUCCEEDED, pb.FAILED, pb.CANCELLED, pb.TIMED_OUT},
}
RECOVERY_COMMANDS = {'Robot.Safety.ResetStop', 'Robot.Safety.Disarm'}


class AuditJournal:
    def __init__(self, path=None, on_failure=None):
        self.path = Path(path) if path else None
        self.on_failure = on_failure
        self.events = deque(maxlen=256)
        self.queue = asyncio.Queue(maxsize=1024)
        self.failed = False
        self.task = None

    async def start(self):
        if self.path and self.task is None:
            self.task = asyncio.create_task(self.worker())

    def emit(self, event):
        self.events.append(event)
        if self.failed:
            return False
        if self.path:
            if self.queue.full():
                self.fail()
                return False
            self.queue.put_nowait(event)
        return True

    def fail(self):
        if not self.failed:
            self.failed = True
            if self.on_failure:
                self.on_failure()

    def write(self, event):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and self.path.stat().st_size >= 32*1024*1024:
            for index in range(3, 0, -1):
                src = self.path if index == 1 else Path(str(self.path)+f'.{index-1}')
                if src.exists():
                    src.replace(Path(str(self.path)+f'.{index}'))
        with self.path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(event, sort_keys=True, allow_nan=False)+'\n')

    async def worker(self):
        while True:
            event = await self.queue.get()
            try:
                await asyncio.to_thread(self.write, event)
            except (OSError, ValueError, TypeError):
                self.fail()
            finally:
                self.queue.task_done()

    async def close(self):
        if self.task:
            try:
                await asyncio.wait_for(self.queue.join(), 2)
            except asyncio.TimeoutError:
                self.fail()
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None


@dataclass
class Execution:
    id: str
    path: str
    args: pb.Object
    fence: int
    session: str
    deadline_ns: int
    fingerprint: bytes
    client_id: str = ''
    phase: int = pb.PENDING
    cancelled: bool = False
    released: bool = False
    event: asyncio.Event = field(default_factory=asyncio.Event)
    history: list = field(default_factory=list)


@dataclass
class StopRecord:
    id: str
    session: str
    dispatched: bool = False
    confirmed: bool = False
    phase: int = pb.PENDING
    event: asyncio.Event = field(default_factory=asyncio.Event)


class CommandPlane:
    def init_commands(self, audit_path=None, stop_wait_ms=200):
        self.executions = {}
        self.invocation_keys = {}
        self.active_execution = None
        self.draining = set()
        self.stop_latched = False
        self.stop_records = {}
        self.latest_stop_id = None
        self.stop_wait_seconds = stop_wait_ms/1000
        self.audit = AuditJournal(audit_path, on_failure=self.audit_failure)

    def audit_event(self, event, **data):
        return self.audit.emit({'event': event, 'time_ns': str(time.time_ns()),
            'monotonic_ns': str(time.monotonic_ns()), 'broker_epoch': self.epoch, **data})

    def audit_failure(self):
        # Never await a disk operation in the safety path.
        self.request_stop('PB_AUDIT_FAILED', record_audit=False)

    def publish_status(self, path, execution_id, phase, reason):
        now = time.monotonic_ns()
        for suffix, scalar in [('Phase', pb.Phase.Name(phase)), ('ExecutionId', execution_id), ('Reason', reason)]:
            key = path+'.Status.'+suffix
            if key in self.records:
                self.internal_sequence += 1
                self.publish_record(pb.Sample(path=key, value=pb.Value(string_value=scalar), quality=pb.OK,
                    source_clock='MONOTONIC', source_epoch=self.epoch, sequence=self.internal_sequence,
                    source_time_ns=now, broker_time_ns=now), now)

    def command_event(self, execution, phase, reason='', physical_confirmed=False):
        if execution.phase in TERMINAL and execution.history:
            return
        execution.phase = phase
        update = pb.CommandUpdate(execution_id=execution.id, path=execution.path, phase=phase,
            reason=reason[:1024], provider_session=execution.session, physical_confirmed=physical_confirmed)
        execution.history.append(update)
        execution.event.set()
        self.publish_status(execution.path, execution.id, phase, reason[:1024])
        self.audit_event('command_phase', execution_id=execution.id, path=execution.path,
                         fence=execution.fence, client_id=execution.client_id,
                         phase=pb.Phase.Name(phase), reason=reason[:1024],
                         physical_confirmed=physical_confirmed,
                         **({'args': MessageToDict(execution.args)} if phase == pb.PENDING else {}))
        if phase in TERMINAL:
            if self.active_execution == execution.id:
                self.active_execution = None
            if physical_confirmed:
                execution.released = True
                self.draining.discard(execution.id)
            else:
                self.draining.add(execution.id)

    def purge_execution_dispatch(self, execution_id):
        if self.provider is None:
            return
        queue = self.provider.control_queue
        retained = []
        while not queue.empty():
            message = queue.get_nowait()
            if message.execution_id != execution_id:
                retained.append(message)
        for message in retained:
            queue.put_nowait(message)

    def cancel_execution(self, execution, reason, terminal=None):
        if not execution.cancelled:
            execution.cancelled = True
            self.purge_execution_dispatch(execution.id)
            self.emit_safety(pb.Dispatch(kind=pb.CANCEL, path=execution.path,
                execution_id=execution.id, fence=execution.fence, broker_epoch=self.epoch,
                provider_session=execution.session, reason=reason))
            self.audit_event('cancel', path=execution.path, execution_id=execution.id,
                             fence=execution.fence, client_id=execution.client_id, reason=reason)
        if terminal is not None and execution.phase not in TERMINAL:
            self.command_event(execution, terminal, reason, physical_confirmed=False)

    def cancel_lease_commands(self, fence, reason):
        for execution in list(self.executions.values()):
            if execution.fence == fence and execution.phase not in TERMINAL:
                self.cancel_execution(execution, reason, terminal=pb.CANCELLED if reason == 'PB_STOPPED' else pb.FAILED)

    def expire_commands(self, now):
        for execution in list(self.executions.values()):
            if execution.phase not in TERMINAL and now >= execution.deadline_ns:
                self.cancel_execution(execution, 'PB_TIMEOUT', terminal=pb.TIMED_OUT)

    def reject(self, code, detail=''):
        return self.error_type(code, detail)

    def begin_invocation(self, request):
        self.require_provider()
        lease = self.require_lease(request.lease)
        path = request.path
        node = self.nodes.get(path)
        if node is None:
            raise self.reject('PB_INVALID_PATH', path)
        if node['kind'] != 'command' or path == 'Robot.Safety.Stop':
            raise self.reject('PB_INVALID_KIND', 'STOP uses its independent RPC')
        if not 1 <= len(request.idempotency_key) <= 128:
            raise self.reject('PB_INVALID_VALUE', 'invocation key required')
        if set(request.args.fields) != set(node['args']):
            raise self.reject('PB_INVALID_VALUE', 'exact command args required')
        for name, spec in node['args'].items():
            self.validate_wire_value(request.args.fields[name], spec, path+'.'+name)
        timeout_ms = request.timeout_ms or node['timeoutMs']
        if not 1 <= timeout_ms <= min(node['timeoutMs'], 120000):
            raise self.reject('PB_INVALID_VALUE', 'command timeout exceeds catalog limit')
        fingerprint = path.encode()+b'\0'+request.args.SerializeToString(deterministic=True)+str(timeout_ms).encode()
        key = (lease.fence, request.idempotency_key)
        if key in self.invocation_keys:
            old = self.executions.get(self.invocation_keys[key])
            if old is None or old.fingerprint != fingerprint:
                raise self.reject('PB_REPLAY', 'invocation key reused or history expired')
            return old
        if len(self.invocation_keys) >= 1024:
            raise self.reject('PB_QUEUE_FULL', 'renew authority before further invocations')
        if self.stop_latched and path not in RECOVERY_COMMANDS:
            raise self.reject('PB_STOPPED')
        if self.active_execution or self.targets or (self.draining and path not in RECOVERY_COMMANDS):
            raise self.reject('PB_RESOURCE_BUSY', 'body/navigation is active or awaiting physical recovery')
        provider = self.require_provider()
        if path not in provider.hello.claims:
            raise self.reject('PB_PROVIDER_MISMATCH', 'provider does not claim command')
        if provider.control_queue.full():
            raise self.reject('PB_QUEUE_FULL')
        if len(self.executions) >= 256:
            for old_id, old in list(self.executions.items()):
                if old.phase in TERMINAL and old.released:
                    self.executions.pop(old_id)
                    break
            else:
                raise self.reject('PB_QUEUE_FULL', 'execution history/resources not released')
        execution = Execution(str(uuid.uuid4()), path, copy.deepcopy(request.args), lease.fence,
            provider.hello.session, time.monotonic_ns()+timeout_ms*1_000_000, fingerprint,
            client_id=lease.client_id)
        self.executions[execution.id] = execution
        self.invocation_keys[key] = execution.id
        self.active_execution = execution.id
        self.command_event(execution, pb.PENDING)
        if (self.audit.failed or self.lease is not lease
                or (self.stop_latched and path not in RECOVERY_COMMANDS)):
            # Synchronous audit overflow may revoke authority while recording
            # PENDING. Never enqueue motion after that revocation.
            execution.released = True
            self.draining.discard(execution.id)
            return execution
        provider.control_queue.put_nowait(pb.Dispatch(kind=pb.INVOKE, path=path, value=request.args,
            execution_id=execution.id, fence=lease.fence, broker_epoch=self.epoch,
            provider_session=execution.session, deadline_monotonic_ns=execution.deadline_ns,
            valid_for_ms=timeout_ms))
        return execution

    async def Invoke(self, request, context):
        execution = None
        try:
            try:
                execution = self.begin_invocation(request)
            except self.error_type as error:
                self.audit_event('invoke_rejected', path=request.path, reason=error.code)
                yield pb.CommandUpdate(execution_id=str(uuid.uuid4()), path=request.path,
                    phase=pb.REJECTED, reason=str(error), physical_confirmed=False)
                return
            index = 0
            while True:
                execution.event.clear()
                while index < len(execution.history):
                    yield copy.deepcopy(execution.history[index])
                    index += 1
                if execution.phase in TERMINAL:
                    return
                await execution.event.wait()
        except asyncio.CancelledError:
            # grpc context.cancelled() may still be false while the server
            # coroutine is unwinding. The cancellation exception is authoritative.
            if execution and execution.phase not in TERMINAL:
                self.cancel_execution(execution, 'CLIENT_STREAM_LOST', terminal=pb.CANCELLED)
            raise
        finally:
            if execution and execution.phase not in TERMINAL and context.cancelled():
                self.cancel_execution(execution, 'CLIENT_STREAM_LOST', terminal=pb.CANCELLED)

    async def Cancel(self, request, context):
        try:
            lease = self.require_lease(request.lease)
            execution = self.executions.get(request.execution_id)
            if execution is None or execution.fence != lease.fence:
                raise self.reject('PB_INVALID_VALUE', 'unknown execution for this lease')
            if execution.phase not in TERMINAL:
                self.cancel_execution(execution, 'USER_CANCEL')
            return pb.Reply(ok=True)
        except self.error_type as error:
            await self.abort(context, error)

    def request_stop(self, reason, record_audit=True, requester='broker'):
        self.stop_latched = True
        provider = self.provider
        record = StopRecord(str(uuid.uuid4()), provider.hello.session if provider else '')
        if len(self.stop_records) >= 32:
            self.stop_records.pop(next(iter(self.stop_records)))
        self.stop_records[record.id] = record
        self.latest_stop_id = record.id
        self.revoke_lease('PB_STOPPED')
        for execution in list(self.executions.values()):
            if execution.phase not in TERMINAL:
                self.cancel_execution(execution, 'PB_STOPPED', terminal=pb.CANCELLED)
        self.publish_status('Robot.Safety.Stop', record.id, pb.PENDING, reason)
        if provider is not None:
            self.emit_safety(pb.Dispatch(kind=pb.STOP, path='Robot.Safety.Stop',
                execution_id=record.id, fence=self.fence, broker_epoch=self.epoch,
                provider_session=record.session, reason=reason[:512]))
        if record_audit:
            self.audit_event('stop', path='Robot.Safety.Stop', execution_id=record.id,
                             client_id=requester, reason=reason[:512], provider_online=provider is not None)
        return record

    async def Stop(self, request, context):
        record = self.request_stop(request.reason or 'Operator STOP', requester=context.peer())
        if record.session:
            try:
                await asyncio.wait_for(record.event.wait(), self.stop_wait_seconds)
            except asyncio.TimeoutError:
                pass
        return pb.StopReply(requested=True, dispatched=record.dispatched,
            robot_confirmed=record.confirmed,
            reason='confirmed' if record.confirmed else ('awaiting physical confirmation' if record.dispatched else 'PB_PROVIDER_OFFLINE_OR_UNCONFIRMED'))

    def process_command_update(self, update, provider):
        if update.provider_session != provider.hello.session:
            raise self.reject('PB_PROVIDER_MISMATCH', 'command provider session')
        stop = self.stop_records.get(update.execution_id)
        if stop is not None:
            if stop.session != update.provider_session or update.path != 'Robot.Safety.Stop':
                raise self.reject('PB_PROVIDER_MISMATCH', 'stop identity')
            if stop.phase in TERMINAL:
                if update.phase == stop.phase and update.physical_confirmed == stop.confirmed:
                    return
                raise self.reject('PB_BAD_TRANSITION', 'terminal stop result immutable')
            if update.phase == pb.ACCEPTED:
                stop.dispatched = True
            elif update.phase == pb.SUCCEEDED and update.physical_confirmed:
                stop.dispatched = stop.confirmed = True
                stop.event.set()
            elif update.phase in (pb.FAILED, pb.REJECTED):
                stop.dispatched = True
                stop.event.set()
            else:
                raise self.reject('PB_BAD_TRANSITION', 'stop receipt/result')
            stop.phase = update.phase
            if stop.id == self.latest_stop_id:
                self.publish_status('Robot.Safety.Stop', stop.id, update.phase, update.reason)
            self.audit_event('stop_feedback', execution_id=stop.id, path=update.path,
                             phase=pb.Phase.Name(update.phase), physical_confirmed=update.physical_confirmed)
            return
        execution = self.executions.get(update.execution_id)
        if execution is None or execution.session != update.provider_session or execution.path != update.path:
            raise self.reject('PB_PROVIDER_MISMATCH', 'execution identity')
        if execution.phase not in TERMINAL and time.monotonic_ns() >= execution.deadline_ns:
            self.cancel_execution(execution, 'PB_TIMEOUT', terminal=pb.TIMED_OUT)
        if execution.phase in TERMINAL:
            if execution.released:
                if (update.phase == execution.phase
                        and update.physical_confirmed == execution.history[-1].physical_confirmed):
                    return
                raise self.reject('PB_BAD_TRANSITION', 'confirmed terminal result immutable')
            if update.phase in TERMINAL and update.physical_confirmed:
                execution.released = True
                self.draining.discard(execution.id)
                self.audit_event('late_physical_release', execution_id=execution.id, path=execution.path,
                                 phase=pb.Phase.Name(update.phase))
                return
            raise self.reject('PB_BAD_TRANSITION', 'terminal phase immutable')
        if update.phase not in TRANSITIONS.get(execution.phase, set()):
            raise self.reject('PB_BAD_TRANSITION')
        if update.physical_confirmed and update.phase not in TERMINAL:
            raise self.reject('PB_BAD_TRANSITION', 'physical completion on a nonterminal phase')
        if update.phase == pb.SUCCEEDED and not update.physical_confirmed:
            raise self.reject('PB_BAD_TRANSITION', 'success requires physical confirmation')
        self.command_event(execution, update.phase, update.reason, update.physical_confirmed)
        if (execution.path == 'Robot.Safety.ResetStop' and update.phase == pb.SUCCEEDED
                and not self.audit.failed):
            self.stop_latched = False
            for old in self.draining:
                self.executions[old].released = True
            self.draining.clear()
