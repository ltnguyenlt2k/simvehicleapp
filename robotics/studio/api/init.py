"""Initialize only the two fixed Docker volumes; never runs or Arms a workflow."""
import os,re,secrets,stat
from pathlib import Path
for name in ('/projects','/control','/audit-sim','/audit-live'):
    path=Path(name)
    if path.is_symlink() or path.resolve()!=path:raise ValueError('unsafe initialization mount')
    path.mkdir(exist_ok=True);os.chown(path,10001,10001);os.chmod(path,0o700)
key=Path('/control/zoo-key')
try:
    fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    with os.fdopen(fd,'w') as stream:stream.write(secrets.token_hex(32)+'\n')
    os.chown(key,10001,10001)
except FileExistsError:
    fd=os.open(key,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('invalid capability file')
        value=os.read(fd,129).decode().strip()
        if re.fullmatch('[a-f0-9]{64}',value) is None:raise ValueError('invalid capability record')
    finally:os.close(fd)
print('Studio project/control volumes initialized; no robot authority requested')
