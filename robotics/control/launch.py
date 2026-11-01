"""Child-process launcher for workflow apps: applies limits in the child, then runs app.main.

Used instead of preexec_fn: forking a process that has gRPC threads and running Python code before exec
is unsafe (gRPC skips its fork handlers). Memory is bounded by the container cgroup.
"""
import resource
import runpy

resource.setrlimit(resource.RLIMIT_CPU, (3600, 3600))
resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
runpy.run_module("app.main", run_name="__main__", alter_sys=True)
