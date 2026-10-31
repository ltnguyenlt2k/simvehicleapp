"""Apply limits in a fresh interpreter before exec; never Python preexec after gRPC forks."""
import os
import resource
import sys

def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_CPU,(300,301))
    resource.setrlimit(resource.RLIMIT_AS,(8*1024**3,8*1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE,(32*1024**2,32*1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE,(128,128))
    # NPROC accounts for this host UID across containers; Docker pids_limit is
    # the tighter per-service bound. Do not break other nonroot SDK services.
    resource.setrlimit(resource.RLIMIT_NPROC,(4096,4096))


if __name__=='__main__':
    if len(sys.argv)<2:raise SystemExit(2)
    child_limits()
    os.execvpe(sys.argv[1],sys.argv[1:],os.environ)
