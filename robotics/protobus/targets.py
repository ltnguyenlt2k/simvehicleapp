"""Bounded Hold admission/release lifecycle; transport integration is separate."""
from dataclasses import dataclass
import uuid

from protobus.v1 import protobus_pb2 as pb

TERMINAL=frozenset((pb.SUCCEEDED,pb.FAILED,pb.REJECTED,pb.CANCELLED,pb.TIMED_OUT))


class TargetError(ValueError):pass


@dataclass
class HoldRecord:
    id:str
    path:str
    owner:str
    fence:int
    session:str
    deadline_ns:int
    last_sequence:int=0
    accepted_sequence:int=0
    release_first_sequence:int=0
    physical_sequence:int=0
    phase:int=pb.PENDING
    physical_phase:int=pb.PHASE_UNSPECIFIED
    resource_released:bool=False

    @property
    def release_requested(self):return self.release_first_sequence>0

    @property
    def physical_released(self):return self.physical_phase in TERMINAL


class HoldLedger:
    def __init__(self,capacity=256):
        if not 1<=capacity<=256:raise ValueError('bounded Hold capacity required')
        self.capacity=capacity;self.records={};self.owners={}

    @staticmethod
    def key(record):return (record.session,record.fence,record.path,record.owner)

    def stage(self,path,owner,fence,session,sequence,deadline_ns,release=False):
        """Returns (record, dispatch_needed); retry never extends release deadline."""
        if (type(fence) is not int or fence<=0 or type(sequence) is not int or sequence<=0
                or type(deadline_ns) is not int or deadline_ns<=0
                or not isinstance(owner,str) or not 1<=len(owner)<=128
                or not isinstance(session,str) or not 1<=len(session)<=128):
            raise TargetError('invalid Hold identity/sequence/deadline')
        key=(session,fence,path,owner);identity=self.owners.get(key)
        record=self.records.get(identity)
        if record is None:
            if len(self.records)>=self.capacity:
                for old_id,old in list(self.records.items()):
                    if old.resource_released and old.phase in TERMINAL:
                        del self.owners[self.key(old)];del self.records[old_id];break
                else:raise TargetError('unconfirmed Hold history is full')
            record=HoldRecord(str(uuid.uuid4()),path,owner,fence,session,deadline_ns)
            self.records[record.id]=record;self.owners[key]=record.id
        if sequence<=record.last_sequence:raise TargetError('target sequence replay')
        if record.phase in TERMINAL:
            if release and record.release_requested and record.physical_released:
                # Same completed zero operation, not a new target or proof about
                # this later transport sequence. Preserve original proof fields.
                return record,False
            if not release or record.physical_released:raise TargetError('terminal Hold owner cannot resume')
        if record.release_requested and not release:raise TargetError('released Hold owner cannot resume')
        record.last_sequence=sequence
        if release:
            if not record.release_requested:
                record.release_first_sequence=sequence;record.deadline_ns=deadline_ns
        else:record.deadline_ns=deadline_ns
        return record,True

    def feedback(self,identity,path,session,sequence,phase,physical_confirmed):
        record=self.records.get(identity)
        if (record is None or record.path!=path or record.session!=session
                or type(sequence) is not int or not 1<=sequence<=record.last_sequence):
            raise TargetError('target feedback identity/sequence mismatch')
        if phase in (pb.ACCEPTED,pb.RUNNING):
            if physical_confirmed:raise TargetError('admission is not physical release')
            if record.phase in TERMINAL:return record # Late admission cannot reopen.
            record.accepted_sequence=max(sequence,record.accepted_sequence)
            record.phase=pb.RUNNING
            return record
        if phase not in TERMINAL:raise TargetError('invalid target phase')
        if physical_confirmed:
            if record.release_requested and sequence<record.release_first_sequence:
                raise TargetError('old target feedback cannot confirm safe release')
            if not record.release_requested and not (phase==pb.REJECTED and record.accepted_sequence==0):
                raise TargetError('physical release requires safe release or proven non-admission')
        if phase==pb.SUCCEEDED and (not physical_confirmed or not record.release_requested
                or sequence<record.release_first_sequence):
            raise TargetError('success requires correlated explicit safe release')
        if record.physical_released:
            if phase==record.physical_phase and physical_confirmed and sequence==record.physical_sequence:return record
            raise TargetError('physical release is immutable')
        if record.phase not in TERMINAL:record.phase=phase
        if physical_confirmed:
            # A rejection/failure may prove pre-admission non-actuation. A late
            # safe release may confirm recovery without rewriting logical timeout.
            record.physical_phase=phase;record.physical_sequence=sequence;record.resource_released=True
        return record

    def expire(self,now_ns):
        expired=[]
        for record in self.records.values():
            if record.phase not in TERMINAL and now_ns>=record.deadline_ns:
                record.phase=pb.TIMED_OUT;expired.append(record)
        return expired

    def revoke(self,fence):
        for record in self.records.values():
            if record.fence==fence and record.phase not in TERMINAL:record.phase=pb.CANCELLED

    def recover(self):
        for record in self.records.values():
            if record.phase in TERMINAL:record.resource_released=True

    @property
    def quarantined(self):return any(not record.resource_released for record in self.records.values())
