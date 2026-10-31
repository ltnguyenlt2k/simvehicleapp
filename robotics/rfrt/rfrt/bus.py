"""One explicitly acquired authority; no reconnect/reacquire or command replay."""
import asyncio
import time
import uuid

import grpc
from protobus.v1 import protobus_pb2 as pb
from .core import AuthorityLost,RunStopped,Outcome,drain
from .transport import KINDS
from .values import UNKNOWN,checked

TERMINAL={pb.SUCCEEDED,pb.FAILED,pb.REJECTED,pb.CANCELLED,pb.TIMED_OUT}


class BusClient:
    def __init__(self,transport,trace=None):
        self.transport=transport;self.trace=trace;self.lease=None;self.lease_deadline=0
        self.tasks=[];self.fault=None;self.closing=False;self.ever_control=False
        self.stop_task=None;self.stop_requested=False;self.body=asyncio.Lock()
        self.active_id=None;self.active_kind=None;self.active_done=None;self.active_ready=None
        self.cancel_wanted=False;self.expected_cancels=set();self.sequence=0
        self.hold_owner=None;self.hold_release=None
        self.clock_value=None;self.clock_advanced=time.monotonic()
        self.seen_executions=set();self.stop_reported=False

    async def open(self,control=False):
        if self.trace:self.trace.header()
        await self.transport.open()
        try:
            ready_by=time.monotonic()+2
            previous_clock=None
            while True:
                paths=['Robot.Connection.IsHandshakeComplete']
                ros=self.transport.descriptor.target_context.kind==pb.ROS_SIM
                if ros:paths+=['Robot.Simulation.TimeNs','Robot.Simulation.IsPaused']
                health=await self.transport.fetch(paths)
                healthy=health['Robot.Connection.IsHandshakeComplete'] is True
                if ros:
                    clock=health['Robot.Simulation.TimeNs']
                    healthy=healthy and clock is not UNKNOWN and clock>0 and health['Robot.Simulation.IsPaused'] is False
                    advancing=healthy and previous_clock is not None and clock>previous_clock
                    previous_clock=clock if healthy else None
                    healthy=advancing
                if healthy:break
                if time.monotonic()>=ready_by:raise AuthorityLost('provider control/safety handshake unavailable')
                await asyncio.sleep(.02)
        except BaseException:
            await self.transport.close();raise
        if control:
            sent=time.monotonic()
            client_id='rfrt-'+uuid.uuid4().hex
            try:
                lease=await self.transport.bus.AcquireLease(pb.LeaseRequest(client_id=client_id,
                    catalog_hash=self.transport.binding.catalog_hash,ttl_ms=1000),timeout=.5)
                if (not lease.token or not lease.fence or lease.broker_epoch!=self.transport.descriptor.broker_epoch
                        or lease.client_id!=client_id or not 1<=lease.remaining_ms<=1000):
                    raise AuthorityLost('invalid lease identity')
                self.lease=lease;self.ever_control=True;self.lease_deadline=sent+lease.remaining_ms/1000
            except BaseException:
                await self.transport.close();raise
            self.tasks.append(asyncio.create_task(self.renew()))
        self.tasks.append(asyncio.create_task(self.watch()))
        if self.trace:self.trace.emit(None,'bus_bound',brokerEpoch=self.transport.descriptor.broker_epoch,
            providerSession=self.transport.descriptor.provider_session,fence=str(self.lease.fence) if self.lease else None)

    def lose(self,reason):
        first=self.fault is None
        self.fault=self.fault or reason
        if first and self.trace:self.trace.emit(None,'authority_lost',reason=reason)
        if self.ever_control:self.ensure_stop(1000)

    async def check(self):
        if self.stop_requested:raise RunStopped('explicit Stop completed')
        if self.fault:raise AuthorityLost(self.fault)
        self.transport.check()
        if self.lease and time.monotonic()>=self.lease_deadline and self.stop_task is None:
            self.lose('local lease deadline expired');raise AuthorityLost(self.fault)

    async def watch(self):
        try:
            while not self.closing and not self.stop_requested:
                await self.transport.refresh_identity()
                if self.transport.descriptor.target_context.kind==pb.ROS_SIM:
                    values=await self.transport.fetch(['Robot.Simulation.TimeNs','Robot.Simulation.IsPaused'])
                    clock=values['Robot.Simulation.TimeNs']
                    if clock is UNKNOWN or values['Robot.Simulation.IsPaused'] is not False:
                        raise AuthorityLost('simulation clock unavailable or paused')
                    if self.clock_value is not None and clock<self.clock_value:raise AuthorityLost('simulation clock regressed')
                    if self.clock_value is None or clock>self.clock_value:self.clock_advanced=time.monotonic()
                    self.clock_value=clock
                    if time.monotonic()-self.clock_advanced>=.3:raise AuthorityLost('simulation clock stopped')
                await asyncio.sleep(.1)
        except Exception:self.lose('target identity/transport lost')

    async def renew(self):
        try:
            while not self.closing and self.stop_task is None:
                await asyncio.sleep(.2);sent=time.monotonic()
                value=await self.transport.bus.RenewLease(self.lease,timeout=.3)
                if (value.token!=self.lease.token or value.fence!=self.lease.fence
                        or value.broker_epoch!=self.lease.broker_epoch or value.client_id!=self.lease.client_id
                        or not 1<=value.remaining_ms<=1000):raise AuthorityLost('renewed lease changed identity')
                self.lease_deadline=sent+value.remaining_ms/1000
        except Exception:
            if self.stop_task is None:self.lose('lease renewal failed')

    async def read(self,paths):
        if self.fault or self.stop_requested:return {path:UNKNOWN for path in paths}
        try:return await self.transport.fetch(paths)
        except Exception:
            self.lose('sample transport/identity lost');return {path:UNKNOWN for path in paths}

    def object(self,values,specs):
        if set(values)!=set(specs):raise ValueError('complete exact target/argument fields required')
        result=pb.Object()
        for name,spec in specs.items():
            value=checked(values[name],spec)
            if ('min' in spec and value<spec['min']) or ('max' in spec and value>spec['max']):raise ValueError('argument outside RSS limits')
            result.fields[name].CopyFrom(pb.Value(**{KINDS[spec['type']]:value}))
        return result

    async def inspect(self,identity,path,deadline,safety=False):
        client=self.transport.safety if safety else self.transport.bus
        state=await client.InspectExecution(pb.ExecutionQuery(catalog_hash=self.transport.binding.catalog_hash,
            broker_epoch=self.transport.descriptor.broker_epoch,execution_id=identity),timeout=max(.001,min(.4,deadline-time.monotonic())))
        if (state.execution_id!=identity or state.path!=path or state.broker_epoch!=self.transport.descriptor.broker_epoch
                or state.provider_session!=self.transport.descriptor.provider_session):raise AuthorityLost('execution correlation mismatch')
        return state

    def ensure_stop(self,timeout_ms):
        if self.stop_task is None:self.stop_task=asyncio.create_task(self.perform_stop(timeout_ms))
        return self.stop_task

    def stop_is_confirmed(self):
        return (self.stop_task is not None and self.stop_task.done() and not self.stop_task.cancelled()
            and self.stop_task.exception() is None and self.stop_task.result().ok and self.stop_task.result().physical_confirmed)

    async def perform_stop(self,timeout_ms):
        deadline=time.monotonic()+timeout_ms/1000
        try:
            reply=await self.transport.safety.Stop(pb.StopRequest(reason='RobotFlow explicit shutdown/safety Stop'),
                timeout=max(.001,min(.5,deadline-time.monotonic())))
            if (not reply.requested or not reply.execution_id or reply.broker_epoch!=self.transport.descriptor.broker_epoch
                    or reply.provider_session!=self.transport.descriptor.provider_session):return Outcome('FAILED','Stop source/receipt mismatch')
            if reply.robot_confirmed:return Outcome('SUCCEEDED',physical_confirmed=True,execution_id=reply.execution_id)
            while time.monotonic()<deadline:
                state=await self.inspect(reply.execution_id,'Robot.Safety.Stop',deadline,True)
                if state.physical_released and state.physical_phase==pb.SUCCEEDED:
                    return Outcome('SUCCEEDED',physical_confirmed=True,execution_id=reply.execution_id)
                if state.logical_phase in (pb.FAILED,pb.REJECTED):return Outcome('FAILED','Stop not physically confirmed')
                await asyncio.sleep(.015)
            return Outcome('TIMED_OUT','Stop physical confirmation deadline')
        except Exception:return Outcome('FAILED','Stop transport/confirmation unavailable')

    async def stop(self,timeout_ms):
        task=self.ensure_stop(timeout_ms)
        try:result=await asyncio.shield(task)
        except asyncio.CancelledError:
            await drain([task]);raise
        self.stop_requested=True
        if self.trace and not self.stop_reported:
            self.stop_reported=True
            self.trace.emit(None,'safety_stop_result',phase=result.phase,physicalConfirmed=result.physical_confirmed,
                executionId=result.execution_id)
        return result

    async def control_allowed(self):
        await self.check()
        if self.stop_task is not None:
            await self.stop(1000);raise RunStopped('Stop owns shutdown')
        if self.lease is None:raise AuthorityLost('no explicit control lease')

    async def invoke(self,path,args,timeout_ms):
        await self.control_allowed()
        if self.body.locked():return Outcome('REJECTED','body already owned')
        if len(self.seen_executions)>=1024:return Outcome('REJECTED','execution budget exhausted; explicit new run required')
        if path=='Robot.Safety.Arm' and not self.transport.descriptor.target_context.remote_arm_authorized:
            return Outcome('REJECTED','target remote Arm permission disabled')
        async with self.body:
            self.active_kind='command';self.active_id=None;self.active_done=asyncio.Event();self.active_ready=asyncio.Event()
            self.cancel_wanted=False;deadline=time.monotonic()+timeout_ms/1000;terminal=None;call=None;reader=None
            try:
                node=self.transport.catalog['nodes'][path]
                call=self.transport.bus.Invoke(pb.Invocation(lease=self.lease,path=path,args=self.object(args,node['args']),
                    timeout_ms=min(timeout_ms,node['timeoutMs']),idempotency_key=str(uuid.uuid4())),timeout=timeout_ms/1000)
                async def consume():
                    async for update in call:
                        if update.path!=path:raise AuthorityLost('command path changed')
                        if update.phase==pb.REJECTED and not update.provider_session:
                            return update
                        if update.provider_session!=self.transport.descriptor.provider_session:raise AuthorityLost('command provider changed')
                        if self.active_id is None:
                            if not update.execution_id or update.execution_id in self.seen_executions or update.phase!=pb.PENDING:
                                raise AuthorityLost('command identity replay or missing initial phase')
                            self.seen_executions.add(update.execution_id)
                        if self.active_id is not None and update.execution_id!=self.active_id:raise AuthorityLost('command execution changed')
                        self.active_id=update.execution_id;self.active_ready.set()
                        if self.cancel_wanted and self.active_id not in self.expected_cancels:await self.cancel_execution(self.active_id,deadline)
                        if update.phase in TERMINAL:return update
                    return None
                reader=asyncio.create_task(consume())
                terminal=await asyncio.shield(reader)
                if terminal is not None and terminal.phase==pb.REJECTED and not terminal.provider_session:
                    return Outcome('REJECTED','broker rejected before admission',execution_id=terminal.execution_id)
                if terminal is None:raise AuthorityLost('command stream ended without terminal')
                confirmed=terminal.physical_confirmed
                while not confirmed and time.monotonic()<deadline:
                    state=await self.inspect(self.active_id,path,deadline)
                    confirmed=state.physical_released
                    if not confirmed:await asyncio.sleep(.015)
                if not confirmed:self.lose('command physical release unconfirmed')
                phase=pb.Phase.Name(terminal.phase)
                return Outcome(phase,'correlated bus terminal',confirmed,self.active_id,
                    phase=='CANCELLED' and self.active_id in self.expected_cancels)
            except asyncio.CancelledError:
                released=False
                if self.stop_task is not None:
                    try:await asyncio.shield(self.stop_task)
                    except asyncio.CancelledError:await drain([self.stop_task])
                    released=self.stop_is_confirmed()
                elif self.active_id:
                    cleanup=asyncio.create_task(self.cancel_and_release(self.active_id,path,deadline))
                    try:released=await asyncio.shield(cleanup)
                    except asyncio.CancelledError:
                        await drain([cleanup]);released=cleanup.result()
                if not released:self.lose('command task cancelled before confirmed release')
                raise
            except Exception:
                self.lose('command transport/deadline/correlation failed')
                return Outcome('TIMED_OUT' if time.monotonic()>=deadline else 'FAILED','command completion unconfirmed')
            finally:
                if call is not None:call.cancel()
                if reader is not None:
                    if not reader.done():reader.cancel()
                    await drain([reader])
                if self.active_id:self.expected_cancels.discard(self.active_id)
                self.active_id=None;self.active_kind=None;self.active_ready.set();self.active_done.set()

    async def cancel_execution(self,identity,deadline):
        self.expected_cancels.add(identity)
        reply=await self.transport.bus.Cancel(pb.CancelRequest(lease=self.lease,execution_id=identity),
            timeout=max(.001,min(.4,deadline-time.monotonic())))
        if not reply.ok:raise AuthorityLost('cancel request rejected')

    async def cancel_and_release(self,identity,path,deadline):
        try:
            await self.cancel_execution(identity,deadline)
            while time.monotonic()<deadline:
                state=await self.inspect(identity,path,deadline)
                if state.physical_released:return True
                await asyncio.sleep(.015)
        except Exception:return False
        return False

    async def target(self,path,values,deadline,release=False):
        self.sequence+=1 # Consume before an ambiguous response; never replay.
        reply=await self.transport.bus.SetTarget(pb.Target(lease=self.lease,path=path,owner_id=self.hold_owner,
            sequence=self.sequence,release=release,value=self.object(values,self.transport.catalog['nodes'][path]['fields'])),
            timeout=max(.001,min(.4,deadline-time.monotonic())))
        if not reply.ok or not reply.operation_id:raise AuthorityLost('Hold receipt identity missing')
        if self.active_id is not None and reply.operation_id!=self.active_id:raise AuthorityLost('Hold execution changed')
        self.active_id=reply.operation_id;self.active_ready.set()
        return self.sequence

    async def release_hold(self,path,deadline):
        try:
            if self.stop_is_confirmed():return False # Global proof is reported as Stop, not fabricated Hold feedback.
            if time.monotonic()>=deadline:return False
            await self.target(path,self.transport.catalog['nodes'][path]['safeValue'],deadline,True)
            while time.monotonic()<deadline:
                if self.stop_is_confirmed():return False
                state=await self.inspect(self.active_id,path,deadline)
                if state.owner_id!=self.hold_owner or state.fence!=self.lease.fence:raise AuthorityLost('Hold owner changed')
                if state.physical_released:return state.release_requested and state.physical_phase==pb.SUCCEEDED
                await asyncio.sleep(.015)
        except Exception:return False
        return False

    async def hold(self,path,values,duration_ms,timeout_ms):
        await self.control_allowed()
        if self.body.locked():return Outcome('REJECTED','body already owned')
        node=self.transport.catalog['nodes'][path]
        async with self.body:
            self.active_kind='hold';self.active_id=None;self.active_done=asyncio.Event();self.active_ready=asyncio.Event()
            self.cancel_wanted=False;self.hold_owner='hold-'+uuid.uuid4().hex;self.hold_release=None
            deadline=time.monotonic()+timeout_ms/1000;phase='FAILED';confirmed=False;expected=False
            try:
                async with asyncio.timeout_at(deadline):
                    first=await self.target(path,values,deadline);next_refresh=time.monotonic()+1/node['refreshHz']
                    # Duration starts after actual backend admission, not receipt.
                    while not self.cancel_wanted:
                        await self.control_allowed()
                        state=await self.inspect(self.active_id,path,deadline)
                        if state.logical_phase in TERMINAL:raise AuthorityLost('Hold ended before admission')
                        if state.accepted_sequence>=first:break
                        if time.monotonic()>=next_refresh:
                            await self.target(path,values,deadline);next_refresh=time.monotonic()+1/node['refreshHz']
                        await asyncio.sleep(.01)
                    end=time.monotonic()+duration_ms/1000
                    while not self.cancel_wanted and time.monotonic()<end:
                        await self.control_allowed()
                        if time.monotonic()>=next_refresh:
                            await self.target(path,values,deadline);next_refresh=time.monotonic()+1/node['refreshHz']
                        await asyncio.sleep(min(.01,max(0,end-time.monotonic())))
                    phase='CANCELLED' if self.cancel_wanted else 'SUCCEEDED';expected=self.cancel_wanted
            except asyncio.CancelledError:raise
            except RunStopped:phase='CANCELLED'
            except TimeoutError:phase='TIMED_OUT'
            except Exception:phase='FAILED'
            finally:
                self.hold_release=asyncio.create_task(self.release_hold(path,deadline))
                try:confirmed=await asyncio.shield(self.hold_release)
                except asyncio.CancelledError:
                    await drain([self.hold_release]);confirmed=self.hold_release.result();raise
                finally:
                    if not confirmed and not self.stop_is_confirmed():self.lose('Hold physical release unconfirmed')
                    self.active_kind=None;self.active_ready.set();self.active_done.set()
            if not confirmed and phase=='SUCCEEDED':phase='FAILED'
            return Outcome(phase,'correlated Hold release' if confirmed else 'Hold release unconfirmed',confirmed,self.active_id or '',expected)

    async def set_target(self,path,values):
        # Closed low-level one-shot pulse. Frontend Move always emits bounded Hold.
        return await self.hold(path,values,0,1000)

    async def cancel_body(self,timeout_ms):
        await self.control_allowed()
        if self.active_kind is None:return Outcome('SUCCEEDED','no active owned body operation')
        deadline=time.monotonic()+timeout_ms/1000;kind=self.active_kind;done=self.active_done;ready=self.active_ready
        self.cancel_wanted=True
        try:
            async with asyncio.timeout_at(deadline):
                if kind=='command':
                    await ready.wait()
                    identity=self.active_id
                    if identity is not None:await self.cancel_execution(identity,deadline)
                await done.wait()
                await self.control_allowed()
                while time.monotonic()<deadline:
                    values=await self.read(['Robot.Safety.Mode'])
                    if values['Robot.Safety.Mode']=='MANUAL':return Outcome('SUCCEEDED','owned body released; MANUAL observed',True)
                    await asyncio.sleep(.015)
        except asyncio.CancelledError:raise
        except Exception:pass
        self.lose('Cancel physical handover unavailable')
        return Outcome('TIMED_OUT','Cancel physical release/authority not confirmed')

    async def close(self):
        self.closing=True
        stopped=await self.stop(1500) if self.ever_control else None
        for task in self.tasks:task.cancel()
        await drain(self.tasks)
        await self.transport.close()
        if stopped is not None and (not stopped.ok or not stopped.physical_confirmed):
            raise AuthorityLost('shutdown physical Stop unconfirmed')
