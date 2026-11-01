"""SafetyLane: a synchronous gRPC server with its own thread pool (ADR-0066 §1, ADR-0069 §3).

It deliberately does not use grpc.aio: an aio server bound to a second event loop still depends on the
process' first loop for dispatch, so a busy or blocked main loop would delay a stop (seen in M23 tests).
A stop goes straight to every provider's safety stream and waits for a confirmed latched stop; the main
loop is only notified afterwards (lease end, setpoints safe) and never on the critical path.
"""
from __future__ import annotations

import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import grpc

from protobus.broker.audit import AuditLog
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

POLL = 0.25  # seconds; bounds how long a closed stream keeps its worker thread


class SafetyLane(rpc.SafetyLaneServicer):
    def __init__(self, timeout_ms: int, audit: AuditLog, on_stop: Callable[[str], None]):
        self.timeout = timeout_ms / 1000
        self.audit, self.on_stop = audit, on_stop
        self.lock = threading.Lock()
        self.providers: dict[str, queue.Queue] = {}
        self.pending: dict[str, tuple[threading.Event, list]] = {}
        self.watchers: set[queue.Queue] = set()
        self.last: pb.StopResult | None = None

    def stop(self, request: pb.StopRequest) -> pb.StopResult:
        request_id = request.request_id or str(uuid.uuid4())
        request.request_id = request_id
        started = time.monotonic()
        self.audit.record("stop.request", request_id=request_id, source=request.source, reason=request.reason)
        with self.lock:
            targets = list(self.providers.values())
            signal = (threading.Event(), [])
            self.pending[request_id] = signal
        if not targets:
            result = pb.StopResult(request_id=request_id, confirmed=False, code="PB1502",
                                   message="no provider on the safety lane", time_ns=time.time_ns())
        else:
            for target in targets:
                target.put(request)
            if signal[0].wait(self.timeout):
                result = signal[1][0]
            else:
                result = pb.StopResult(request_id=request_id, confirmed=False, code="PB1501",
                                       message="stop not confirmed in time", time_ns=time.time_ns())
        with self.lock:
            self.pending.pop(request_id, None)
            self.last = result
            watchers = list(self.watchers)
        for watcher in watchers:
            watcher.put(result)
        self.audit.record("stop.result", request_id=request_id, confirmed=result.confirmed, code=result.code,
                          latency_ms=round((time.monotonic() - started) * 1000, 2))
        self.on_stop(request.source or "UNKNOWN")
        return result

    def Stop(self, request, context):
        return self.stop(request)

    def StopState(self, request, context):
        watcher: queue.Queue = queue.Queue()
        with self.lock:
            self.watchers.add(watcher)
            last = self.last
        try:
            if last is not None:
                yield last
            while context.is_active():
                try:
                    yield watcher.get(timeout=POLL)
                except queue.Empty:
                    continue
        finally:
            with self.lock:
                self.watchers.discard(watcher)

    def AttachProvider(self, request_iterator, context):
        first = next(request_iterator, None)
        if first is None or not first.HasField("attach") or not first.attach.provider_id:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "first message must be attach")
        provider_id = first.attach.provider_id
        outbox: queue.Queue = queue.Queue()
        with self.lock:
            self.providers[provider_id] = outbox
        self.audit.record("safety.attach", provider=provider_id)

        def read_results():
            try:
                for message in request_iterator:
                    if message.HasField("result") and message.result.confirmed:
                        with self.lock:
                            signal = self.pending.get(message.result.request_id)
                        if signal is not None and not signal[0].is_set():
                            signal[1].append(message.result)
                            signal[0].set()
            except grpc.RpcError:
                pass

        reader = threading.Thread(target=read_results, name=f"safety-read-{provider_id}", daemon=True)
        reader.start()
        try:
            while context.is_active() and reader.is_alive():
                try:
                    yield outbox.get(timeout=POLL)
                except queue.Empty:
                    continue
        finally:
            with self.lock:
                if self.providers.get(provider_id) is outbox:
                    del self.providers[provider_id]
            self.audit.record("safety.detach", provider=provider_id)


class SafetyServer:
    def __init__(self, bind: str, port: int, timeout_ms: int, audit: AuditLog, on_stop: Callable[[str], None],
                 max_workers: int = 32):
        self.lane = SafetyLane(timeout_ms, audit, on_stop)
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="safety")
        self.server = grpc.server(self.executor, maximum_concurrent_rpcs=max_workers - 2)
        rpc.add_SafetyLaneServicer_to_server(self.lane, self.server)
        self.bound_port = self.server.add_insecure_port(f"{bind}:{port}")

    def start(self) -> None:
        self.server.start()

    async def stop_from_loop(self, request: pb.StopRequest) -> pb.StopResult:
        """Used by Broker.Execute for safety-lane commands; runs the stop on a lane thread."""
        import asyncio
        return await asyncio.get_running_loop().run_in_executor(self.executor, self.lane.stop, request)

    def shutdown(self) -> None:
        self.server.stop(0.5).wait(5)
        self.executor.shutdown(wait=False, cancel_futures=True)
