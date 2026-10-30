"""Actual immutable adapter-source identity and closed target context checks."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re

from protobus.v1 import protobus_pb2 as pb


def data_hash(value):
    return 'sha256:'+hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()


@lru_cache(maxsize=1)
def source_hash():
    root=Path(__file__).resolve().parent
    files={path.name:'sha256:'+hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(root.glob('*.py'))}
    for name in ('requirements.txt','bridge-requirements.txt','bridge-build-requirements.txt','interface-source/manifest.json'):
        files[name]='sha256:'+hashlib.sha256((root/name).read_bytes()).hexdigest()
    for name in ('protobus/v1/protobus.proto','dog-control-authority.v1.json','units.v1.json'):
        files['wire/'+name]='sha256:'+hashlib.sha256((Path('/contracts')/name).read_bytes()).hexdigest()
    return data_hash(files)


def validate_context(context):
    if context.kind not in (pb.KINEMATIC_MOCK,pb.ROS_SIM):raise ValueError('explicit provider kind required')
    for name in ('mapping_hash','adapter_source_hash'):
        if not re.fullmatch('sha256:[a-f0-9]{64}',getattr(context,name)):raise ValueError('actual source/profile hashes required')
    if not 1<=len(context.source_epoch)<=128:raise ValueError('source epoch required')
    if context.kind==pb.ROS_SIM:
        for name in ('brain_boot_id','scene_epoch','scene_id','map_generation'):
            if not 1<=len(getattr(context,name))<=256:raise ValueError('complete ROS scene/Brain context required')
        if not re.fullmatch('[a-f0-9]{64}',context.config_hash):raise ValueError('Brain config identity required')
    elif any((context.brain_boot_id,context.scene_epoch,context.scene_id,context.config_hash,context.map_generation)):
        raise ValueError('mock must not claim Brain or physical-map context')
    return context
