"""Provider side of protobus.v1, shared by the mock and the ROS 2 bridge (Python ≥ 3.10).

The provider keeps two streams: Provider.Attach (samples, commands, setpoints) on the main port and
SafetyLane.AttachProvider (stops) on the safety port, so a stop never queues behind other traffic.
Both reconnect with bounded backoff; on loss of the main stream the broker marks the paths UNAVAILABLE.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Protocol

import grpc

from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.wire import from_struct, to_value

log = logging.getLogger("protobus.provider")


class Handler(Protocol):
    async def on_command(self, request_id: str, path: str, args: dict, timeout_ms: int) -> None: ...
    async def on_cancel(self, request_id: str) -> None: ...
    async def on_setpoint(self, path: str, fields: dict, safe: bool, expires_in_ms: int) -> None: ...
    async def on_control(self, active: bool, lease_id: str) -> None: ...
    async def on_stop(self, request: pb.StopRequest) -> bool: ...  # True once a latched stop is observed


class ProviderClient:
    def __init__(self, target: str, safety_target: str, provider_id: str, catalog_hash: str,
                 paths: list[str], handler: Handler):
        self.target, self.safety_target = target, safety_target
        self.provider_id, self.catalog_hash = provider_id, catalog_hash
        self.paths = sorted(paths)
        self.handler = handler
        self.outbox: asyncio.Queue = asyncio.Queue(maxsize=4096)
        self.connected = asyncio.Event()
        self.safety_connected = asyncio.Event()
        self.refused: str | None = None
        self.dropped_samples = 0

    # ------------------------------------------------------------ outgoing

    def publish(self, values: dict[str, Any], capture_ns: int | None = None, quality: int = pb.OK) -> None:
        if not self.connected.is_set() or not values:
            return
        capture = capture_ns if capture_ns is not None else time.time_ns()
        samples = [pb.Sample(path=p, value=to_value(v), capture_time_ns=capture, quality=quality)
                   for p, v in values.items()]
        self._enqueue(pb.ProviderMessage(samples=pb.ProviderSamples(samples=samples)), sample=True)

    def command_update(self, request_id: str, phase: int, code: str = "", message: str = "") -> None:
        self._enqueue(pb.ProviderMessage(command_update=pb.CommandUpdate(
            request_id=request_id, phase=phase, code=code, message=message, time_ns=time.time_ns())))

    def _enqueue(self, message: pb.ProviderMessage, sample: bool = False) -> None:
        try:
            self.outbox.put_nowait(message)
        except asyncio.QueueFull:
            if sample:
                self.dropped_samples += 1  # telemetry is latest-wins; never block command traffic
            else:
                raise

    # ------------------------------------------------------------ streams

    async def run(self) -> None:
        await asyncio.gather(self._main_loop(), self._safety_loop())

    async def _main_loop(self) -> None:
        backoff = 0.2
        while True:
            try:
                async with grpc.aio.insecure_channel(self.target) as channel:
                    await self._attach(rpc.ProviderStub(channel))
                    backoff = 0.2
            except grpc.aio.AioRpcError as error:
                log.warning("provider stream lost: %s", error.code().name)
            self.connected.clear()
            if self.refused:
                log.error("broker refused provider: %s", self.refused)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)

    async def _attach(self, stub: rpc.ProviderStub) -> None:
        while not self.outbox.empty():
            self.outbox.get_nowait()

        async def outgoing():
            yield pb.ProviderMessage(hello=pb.ProviderHello(
                provider_id=self.provider_id, catalog_hash=self.catalog_hash, owned_paths=self.paths))
            while True:
                yield await self.outbox.get()

        call = stub.Attach(outgoing())
        async for message in call:
            body = message.WhichOneof("body")
            if body == "welcome":
                if not message.welcome.accepted:
                    self.refused = message.welcome.reason
                    call.cancel()
                    return
                self.refused = None
                self.connected.set()
            elif body == "command":
                c = message.command
                asyncio.ensure_future(self.handler.on_command(c.request_id, c.path, from_struct(c.args), c.timeout_ms))
            elif body == "cancel":
                asyncio.ensure_future(self.handler.on_cancel(message.cancel.request_id))
            elif body == "setpoint":
                s = message.setpoint
                await self.handler.on_setpoint(s.path, dict(s.fields), s.safe, s.expires_in_ms)
            elif body == "control":
                await self.handler.on_control(message.control.active, message.control.lease_id)

    async def _safety_loop(self) -> None:
        backoff = 0.2
        while True:
            try:
                async with grpc.aio.insecure_channel(self.safety_target) as channel:
                    results: asyncio.Queue = asyncio.Queue()

                    async def outgoing():
                        yield pb.SafetyProviderMessage(attach=pb.SafetyAttach(provider_id=self.provider_id))
                        while True:
                            yield pb.SafetyProviderMessage(result=await results.get())

                    call = rpc.SafetyLaneStub(channel).AttachProvider(outgoing())
                    self.safety_connected.set()
                    backoff = 0.2
                    async for request in call:
                        confirmed = await self.handler.on_stop(request)
                        results.put_nowait(pb.StopResult(request_id=request.request_id, confirmed=confirmed,
                                                         code="" if confirmed else "PB1501",
                                                         message="latched stop observed" if confirmed else "not confirmed",
                                                         time_ns=time.time_ns()))
            except grpc.aio.AioRpcError as error:
                log.warning("safety stream lost: %s", error.code().name)
            self.safety_connected.clear()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)
