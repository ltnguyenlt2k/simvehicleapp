"""gRPC wiring of the main listener: Broker (clients) and Provider (mock, ros2 bridge)."""
from __future__ import annotations

import asyncio
import json
import time

import grpc

from protobus.broker.audit import AuditLog
from protobus.broker.control import Control
from protobus.broker.providers import Registry
from protobus.broker.safety import SafetyServer
from protobus.broker.store import Store
from protobus.catalog import Catalog, CatalogError
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

STATUS = {"PB1101": grpc.StatusCode.NOT_FOUND, "PB1201": grpc.StatusCode.PERMISSION_DENIED,
          "PB1202": grpc.StatusCode.FAILED_PRECONDITION, "PB1403": grpc.StatusCode.UNAVAILABLE}


async def abort(context, error: CatalogError):
    await context.abort(STATUS.get(error.code, grpc.StatusCode.INVALID_ARGUMENT), f"{error.code} {error.message}")


class BrokerService(rpc.BrokerServicer, rpc.ProviderServicer):
    def __init__(self, catalog: Catalog, audit: AuditLog):
        self.catalog = catalog
        self.audit = audit
        self.store = Store(catalog)
        self.registry = Registry(catalog)
        self.control = Control(catalog, self.registry, audit)
        self.safety: SafetyServer | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._ticker: asyncio.Task | None = None

    # ------------------------------------------------------------ lifecycle

    def start_background(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._ticker = asyncio.create_task(self._tick())

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(0.05)
            self.control.expire_lease_if_due()
            self.store.sweep()

    def notify_stop(self, source: str) -> None:
        """Called from the safety thread; schedules control cleanup on the main loop."""
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.control.on_stop, source)

    # ------------------------------------------------------------ Broker

    async def Health(self, request, context):
        return pb.HealthResponse(ready=True, catalog_hash=self.catalog.hash,
                                 providers=sorted(self.registry.providers),
                                 lease_holder=self.control.lease.client_id if self.control.lease else "")

    async def GetCatalog(self, request, context):
        return pb.CatalogResponse(catalog_hash=self.catalog.hash, catalog_json=json.dumps(self.catalog.raw))

    async def Get(self, request, context):
        try:
            paths = self.catalog.expand(list(request.paths))
        except CatalogError as error:
            await abort(context, error)
        now = time.monotonic_ns()
        return pb.GetResponse(samples=[self.store.current(p, now) for p in paths])

    async def Subscribe(self, request, context):
        try:
            paths = self.catalog.expand(list(request.paths))
        except CatalogError as error:
            await abort(context, error)
        sub = self.store.subscribe(paths, request.max_rate_hz, request.include_initial)
        try:
            while True:
                await sub.wake.wait()
                sub.wake.clear()
                batch = sub.take(time.monotonic())
                if batch:
                    lagged, sub.lagged = sub.lagged, False
                    yield pb.SubscribeResponse(samples=batch, lagged=lagged)
        finally:
            self.store.unsubscribe(sub)

    async def _guard(self, context, call):
        try:
            return call()
        except CatalogError as error:
            await abort(context, error)

    async def AcquireControl(self, request, context):
        return await self._guard(context, lambda: self.control.acquire(request.client_id))

    async def RenewControl(self, request, context):
        return await self._guard(context, lambda: self.control.renew(request.lease_id))

    async def ReleaseControl(self, request, context):
        return pb.ReleaseResponse(released=self.control.release(request.lease_id))

    async def SetSetpoint(self, request, context):
        try:
            return self.control.setpoint(request.lease_id, request.path, dict(request.fields))
        except CatalogError as error:
            return pb.SetpointAck(accepted=False, code=error.code, message=error.message)

    async def Execute(self, request, context):
        node = self.catalog.nodes.get(request.path, {})
        if node.get("safetyLane"):
            result = await self.safety.stop_from_loop(pb.StopRequest(
                request_id=request.request_id, source="WORKFLOW", reason="safety-lane command"))
            phase = pb.SUCCEEDED if result.confirmed else pb.FAILED
            yield pb.CommandUpdate(request_id=result.request_id, path=request.path, phase=phase,
                                   code=result.code, message=result.message, time_ns=result.time_ns)
            return
        try:
            async for item in self.control.execute(request):
                yield item
        except CatalogError as error:
            yield pb.CommandUpdate(request_id=request.request_id, path=request.path, phase=pb.REJECTED,
                                   code=error.code, message=error.message, time_ns=time.time_ns())

    async def Cancel(self, request, context):
        return await self._guard(context, lambda: self.control.cancel(request.lease_id, request.request_id))

    async def Events(self, request, context):
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "events are delivered as samples in v0.1")

    # ------------------------------------------------------------ Provider

    async def Attach(self, request_iterator, context):
        first = await request_iterator.__anext__()
        if not first.HasField("hello"):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "first message must be hello")
        try:
            conn = self.registry.attach(first.hello)
        except CatalogError as error:
            self.audit.record("provider.refused", provider=first.hello.provider_id, code=error.code)
            yield pb.BrokerMessage(welcome=pb.Welcome(accepted=False, reason=f"{error.code} {error.message}"))
            return
        self.audit.record("provider.attach", provider=conn.provider_id, paths=len(conn.paths))
        yield pb.BrokerMessage(welcome=pb.Welcome(accepted=True))
        if self.control.lease is not None:
            conn.send(pb.BrokerMessage(control=pb.ControlState(active=True, lease_id=self.control.lease.lease_id)))

        async def read():
            async for message in request_iterator:
                body = message.WhichOneof("body")
                if body == "samples":
                    owned = [s for s in message.samples.samples if s.path in conn.paths]
                    self.store.put(owned)
                elif body == "command_update":
                    self.control.on_provider_update(conn, message.command_update)

        reader = asyncio.create_task(read())
        try:
            while not reader.done():
                getter = asyncio.create_task(conn.outbox.get())
                done, _ = await asyncio.wait({getter, reader}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield getter.result()
                else:
                    getter.cancel()
        finally:
            reader.cancel()
            paths = self.registry.detach(conn)
            self.control.on_provider_lost(conn)
            self.store.mark_unavailable(paths)
            self.audit.record("provider.detach", provider=conn.provider_id)
