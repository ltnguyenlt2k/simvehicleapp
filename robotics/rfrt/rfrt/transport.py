"""Independent typed Protobus transport; no broker/compiler/ROS implementation."""
import asyncio
from dataclasses import dataclass
from pathlib import Path
import re
import time

import grpc
from google.protobuf.json_format import MessageToDict,ParseDict
from jsonschema import Draft202012Validator
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from .core import AuthorityLost
from .values import UNKNOWN,checked
from .artifact import decode,SCHEMAS

KINDS={'bool':'bool_value','int32':'int32_value','int64':'int64_value','uint8':'uint32_value',
       'uint32':'uint32_value','float32':'float32_value','float64':'float64_value',
       'string':'string_value','enum':'string_value'}


def stable_context(value):
    result=pb.TargetContext();result.CopyFrom(value)
    if result.kind not in (pb.KINEMATIC_MOCK,pb.ROS_SIM):raise ValueError('explicit provider kind required')
    for name in ('mapping_hash','adapter_source_hash'):
        if not re.fullmatch('sha256:[a-f0-9]{64}',getattr(result,name)):raise ValueError('measured target hash required')
    if result.kind==pb.KINEMATIC_MOCK:
        if any((result.brain_boot_id,result.scene_epoch,result.config_hash,result.scene_id,result.map_generation)):
            raise ValueError('mock cannot claim physical-map context')
        result.source_epoch=''
    else:
        if not all(1<=len(getattr(result,name))<=256 for name in ('source_epoch','brain_boot_id','scene_epoch','scene_id','map_generation')):
            raise ValueError('complete observed ROS context required')
        if not re.fullmatch('[a-f0-9]{64}',result.config_hash):raise ValueError('Brain config identity required')
    return result.SerializeToString(deterministic=True)


@dataclass(frozen=True)
class TargetBinding:
    robot_id:str
    profile_id:str
    catalog_hash:str
    context_bytes:bytes

    def __post_init__(self):
        if type(self.context_bytes) is not bytes:raise ValueError('immutable context bytes required')
        if not all(isinstance(value,str) and 1<=len(value)<=128 for value in (self.robot_id,self.profile_id)):
            raise ValueError('bounded robot/profile identities required')
        if not re.fullmatch('sha256:[a-f0-9]{64}',self.catalog_hash):raise ValueError('catalog hash required')
        if stable_context(pb.TargetContext.FromString(self.context_bytes))!=self.context_bytes:
            raise ValueError('canonical immutable target context required')

    @classmethod
    def record(cls,descriptor):
        """Explicit deployment-record action; never infer a binding at Run launch."""
        return cls(descriptor.robot_id,descriptor.profile_id,descriptor.catalog_hash,stable_context(descriptor.target_context))

    def matches(self,descriptor):
        return (descriptor.robot_id==self.robot_id and descriptor.profile_id==self.profile_id
            and descriptor.catalog_hash==self.catalog_hash and stable_context(descriptor.target_context)==self.context_bytes)

    def record_json(self):
        return dict(schema='rftarget.v1',robotId=self.robot_id,profileId=self.profile_id,catalogHash=self.catalog_hash,
            context=MessageToDict(pb.TargetContext.FromString(self.context_bytes)))

    @classmethod
    def from_json(cls,value,contracts=None):
        Draft202012Validator(decode(((Path(contracts) if contracts else SCHEMAS)/'rftarget.v1.json').read_bytes())).validate(value)
        return cls(value['robotId'],value['profileId'],value['catalogHash'],stable_context(ParseDict(value['context'],pb.TargetContext())))


class BusTransport:
    def __init__(self,address,catalog,binding,host_clock_id=None):
        if catalog['catalogHash']!=binding.catalog_hash:raise ValueError('artifact catalog and deployment binding differ')
        self.address=address;self.catalog=catalog;self.binding=binding
        self.host_clock_id=host_clock_id or Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.channel=None;self.safety_channel=None;self.descriptor=None;self.fault=None;self.closed=False

    def check(self):
        if self.fault or self.closed:raise AuthorityLost(self.fault or 'transport closed')

    def fail(self,reason):
        self.fault=self.fault or reason
        raise AuthorityLost(self.fault)

    def validate_descriptor(self,value):
        try:matches=self.binding.matches(value)
        except ValueError:matches=False
        if (not matches or value.backend!='SIM' or value.protocol_version!='1.6' or not value.audit_ok
                or not value.provider_online or not value.provider_session or not value.broker_epoch
                or value.host_clock_id!=self.host_clock_id):self.fail('target identity/health mismatch')
        if not 1<=len(value.target_context.source_epoch)<=128:self.fail('current source epoch missing')
        if value.target_context.kind==pb.KINEMATIC_MOCK and value.target_context.source_epoch!=value.provider_session:
            self.fail('mock source epoch differs from current provider')
        if self.descriptor is not None and (value.broker_epoch!=self.descriptor.broker_epoch
                or value.provider_session!=self.descriptor.provider_session):self.fail('broker/provider session changed')

    async def open(self):
        if self.channel is not None or self.closed:raise AuthorityLost('transport cannot resume or reopen')
        self.channel=grpc.aio.insecure_channel(self.address)
        self.safety_channel=grpc.aio.insecure_channel(self.address,options=[('grpc.use_local_subchannel_pool',1)])
        self.bus=rpc.BusStub(self.channel);self.safety=rpc.BusStub(self.safety_channel)
        try:
            await asyncio.wait_for(asyncio.gather(self.channel.channel_ready(),self.safety_channel.channel_ready()),3)
            value=await self.bus.Describe(pb.Empty(),timeout=.5)
            self.validate_descriptor(value)
            self.descriptor=pb.Descriptor();self.descriptor.CopyFrom(value)
        except BaseException:
            self.fault=self.fault or 'initial transport unavailable'
            await self.close();raise

    async def refresh_identity(self):
        self.check()
        try:value=await self.bus.Describe(pb.Empty(),timeout=.5)
        except grpc.aio.AioRpcError:self.fail('identity transport lost')
        self.validate_descriptor(value)

    async def fetch(self,paths):
        self.check();paths=sorted(set(paths))
        if any(path not in self.catalog['nodes'] or self.catalog['nodes'][path]['kind'] not in ('sensor','attribute') for path in paths):
            raise ValueError('known readable RSS paths required')
        if not paths:return {}
        requested=paths
        clock_path='Robot.Simulation.TimeNs';paused_path='Robot.Simulation.IsPaused'
        needs_clock=self.descriptor.target_context.kind==pb.ROS_SIM and any(not (path.startswith('Robot.Connection.') or '.Status.' in path) for path in requested)
        if needs_clock:paths=sorted(set(paths)|{clock_path,paused_path})
        try:batch=await self.bus.Get(pb.Query(paths=paths,catalog_hash=self.binding.catalog_hash),timeout=.5)
        except grpc.aio.AioRpcError:self.fail('sample transport lost')
        if batch.broker_epoch!=self.descriptor.broker_epoch or batch.provider_session!=self.descriptor.provider_session:
            self.fail('sample session changed')
        records={item.path:item for item in batch.samples}
        if len(records)!=len(batch.samples) or set(records)!=set(paths):self.fail('incomplete or duplicate sample batch')
        result={};now=time.monotonic_ns();context=self.descriptor.target_context
        for path,item in records.items():
            spec=self.catalog['nodes'][path];result[path]=UNKNOWN
            if item.quality in (pb.NONE,pb.STALE):continue
            if item.quality!=pb.OK:self.fail('invalid sample quality')
            owned=path.startswith('Robot.Connection.') or '.Status.' in path
            epoch=self.descriptor.broker_epoch if owned else context.source_epoch
            clock='MONOTONIC' if owned or context.kind==pb.KINEMATIC_MOCK else 'ROS_TIME'
            if item.source_epoch!=epoch or item.source_clock!=clock:self.fail('sample source identity mismatch')
            if item.source_time_ns<0 or item.broker_time_ns<=0 or not item.sequence:self.fail('invalid sample timestamp/sequence')
            # Only host-domain broker receipt age is compared to host monotonic.
            # ROS validation in the adapter is supplemented by same-batch clock
            # checking below; no host-minus-ROS timestamp subtraction is valid.
            age=now-item.broker_time_ns
            if age<0 or (not owned and spec.get('maxAgeMs') and age>spec['maxAgeMs']*1_000_000):continue
            if clock=='MONOTONIC':
                if item.source_time_ns>now:self.fail('future host-domain capture')
                if not owned and spec.get('maxAgeMs') and now-item.source_time_ns>spec['maxAgeMs']*1_000_000:continue
            if item.value.WhichOneof('kind')!=KINDS[spec['type']]:self.fail('sample wire type mismatch')
            try:result[path]=checked(getattr(item.value,KINDS[spec['type']]),spec)
            except ValueError:self.fail('invalid typed sample')
        if needs_clock:
            clock=result[clock_path];paused=result[paused_path]
            clock_bound=self.catalog['nodes'][clock_path].get('maxAgeMs',0)*1_000_000
            for path in requested:
                if path.startswith('Robot.Connection.') or '.Status.' in path or path==paused_path:continue
                if type(clock) is not int or paused is not False:
                    result[path]=UNKNOWN;continue
                maximum=self.catalog['nodes'][path].get('maxAgeMs',0)*1_000_000
                if maximum and clock-records[path].source_time_ns>=maximum:result[path]=UNKNOWN
                # The exported sim-state clock can lag a current sensor capture.
                # Gross future timestamps cannot fit its own freshness bound.
                if records[path].source_time_ns-clock>clock_bound:result[path]=UNKNOWN
        return {path:result[path] for path in requested}

    async def close(self):
        self.closed=True
        for channel in (self.channel,self.safety_channel):
            if channel is not None:await channel.close()
