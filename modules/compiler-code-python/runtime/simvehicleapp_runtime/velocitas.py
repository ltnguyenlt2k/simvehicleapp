"""The runtime on the Velocitas Python SDK (``velocitas-sdk==0.15.7``, ADR-0040 §1–2; C++ ``Velocitas.cpp``).

``SimVehicleApp`` is a ``VehicleApp``: when the SDK is connected (``on_start``) it binds the generated
workflows, reads the baselines, subscribes the signals by VSS path on ``sdv.databroker.v1`` and the MQTT
topics, and runs the strand on the real clock in the SDK's asyncio loop — one loop, one strand. SDK
callbacks only post on the strand, so the runtime never runs concurrently with itself.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

import grpc  # type: ignore
from velocitas_sdk.proto.types_pb2 import Datapoint, DatapointError  # type: ignore
from velocitas_sdk.vehicle_app import VehicleApp  # type: ignore

from . import values as V
from .runtime import PubSub, Runtime, StdoutTraceSink, TraceRecord, VehicleAccess
from .strand import MonotonicClock, Strand, epoch_ms

logger = logging.getLogger("simvehicleapp")

_ARRAYS = {"string_array", "bool_array", "int32_array", "int64_array", "uint32_array", "uint64_array", "float_array", "double_array"}


def from_sdk(dp: Any) -> Optional[Any]:
    """``sdv.databroker.v1`` Datapoint ⇒ runtime value; None when the broker has no valid value."""
    which = dp.WhichOneof("value")
    if which is None or which == "failure_value":
        return None
    v = getattr(dp, which)
    if which in _ARRAYS:
        return list(v.values)
    return v


def to_sdk(type_: str, value: Any) -> Any:
    """Runtime value of VSS type ``type_`` ⇒ Datapoint to set (actuators are never arrays, ADR-0018)."""
    if type_ == "boolean":
        return Datapoint(bool_value=bool(value))
    if type_ in ("int8", "int16", "int32"):
        return Datapoint(int32_value=int(value))
    if type_ == "int64":
        return Datapoint(int64_value=int(value))
    # The databroker stores uint8/uint16 as uint32 on sdv.databroker.v1 (same as the C++ runtime).
    if type_ in ("uint8", "uint16", "uint32"):
        return Datapoint(uint32_value=int(value))
    if type_ == "uint64":
        return Datapoint(uint64_value=int(value))
    if type_ == "float":
        return Datapoint(float_value=float(value))
    if type_ == "double":
        return Datapoint(double_value=float(value))
    if type_ == "string":
        return Datapoint(string_value=str(value))
    raise ValueError(f"simvehicleapp runtime: cannot write a value of type {type_}")


def _runtime_value(v: Any, type_: str) -> Any:
    """SDK value ⇒ the representation of the VSS type (``float`` rounded to binary32 like the simulator)."""
    return V.from_json(v, type_) if v is not None else None


class VelocitasVehicleAccess(VehicleAccess):
    def __init__(self, vdb: Any, strand: Strand) -> None:
        self._vdb = vdb
        self._strand = strand
        self._baselines: Dict[str, Any] = {}
        self._tasks: List[asyncio.Task] = []

    async def prefetch(self, paths: Dict[str, str]) -> None:
        """Baselines before the app starts (``current`` is synchronous on the strand)."""
        for path, type_ in sorted(paths.items()):
            try:
                reply = await self._vdb.GetDatapoints([path])
                dp = reply.datapoints.get(path)
                v = from_sdk(dp) if dp is not None else None
                if v is not None:
                    self._baselines[path] = _runtime_value(v, type_)
            except Exception as e:  # noqa: BLE001 — a missing baseline only means "no value yet"
                logger.warning("simvehicleapp: no current value of %s: %s", path, e)

    def current(self, path: str, type_: str) -> Optional[Any]:
        return self._baselines.get(path)

    def subscribe(self, path: str, type_: str, on_value: Callable[[Any], None]) -> None:
        async def forever() -> None:
            while True:
                try:
                    async for reply in self._vdb.Subscribe(f"SELECT {path}"):
                        dp = reply.fields.get(path)
                        v = from_sdk(dp) if dp is not None else None
                        if v is not None:
                            value = _runtime_value(v, type_)
                            self._strand.post(lambda value=value: on_value(value))
                    return
                except asyncio.CancelledError:
                    raise
                except grpc.aio.AioRpcError as e:  # type: ignore
                    if e.code() is grpc.StatusCode.INVALID_ARGUMENT:
                        logger.error("simvehicleapp: subscription to %s failed: %s", path, e.details())
                        return
                    logger.warning("simvehicleapp: subscription to %s lost (%s), retrying", path, e.code())
                    await asyncio.sleep(2.5)

        self._tasks.append(asyncio.get_event_loop().create_task(forever(), name=f"SELECT {path}"))

    def get(self, path: str, type_: str, done: Callable[[Optional[Any], str], None]) -> None:
        async def call() -> None:
            try:
                reply = await self._vdb.GetDatapoints([path])
                dp = reply.datapoints.get(path)
                v = from_sdk(dp) if dp is not None else None
                value = _runtime_value(v, type_)
                self._strand.post(lambda: done(value, ""))
            except Exception as e:  # noqa: BLE001
                msg = e.details() if isinstance(e, grpc.aio.AioRpcError) else str(e)  # type: ignore
                self._strand.post(lambda: done(None, msg or "read failed"))

        asyncio.get_event_loop().create_task(call())

    def set(self, path: str, type_: str, value: Any, done: Optional[Callable[[str], None]]) -> None:
        async def call() -> None:
            err = ""
            try:
                reply = await self._vdb.SetDatapoints({path: to_sdk(type_, value)})
                if reply.errors:
                    code = reply.errors.get(path, next(iter(reply.errors.values())))
                    err = DatapointError.Name(code)
            except Exception as e:  # noqa: BLE001
                err = (e.details() if isinstance(e, grpc.aio.AioRpcError) else str(e)) or "write failed"  # type: ignore
            if err:
                logger.error("simvehicleapp: set %s failed: %s", path, err)
            if done is not None:
                self._strand.post(lambda: done(err))

        asyncio.get_event_loop().create_task(call())

    def close(self) -> None:
        for t in self._tasks:
            t.cancel()


class VelocitasPubSub(PubSub):
    def __init__(self, client: Any, strand: Strand) -> None:
        self._client = client
        self._strand = strand
        self._handler: Optional[Callable[[str, str, Optional[str]], None]] = None
        self._filters: List[str] = []

    def set_handler(self, handler: Callable[[str, str, Optional[str]], None]) -> None:
        self._handler = handler

    def subscribe(self, topic_filter: str) -> None:
        self._filters.append(topic_filter)

    async def register(self) -> None:
        for flt in self._filters:
            # The SDK gives the payload only: deliver it to the triggers of this exact subscription.
            async def on_message(payload: str, flt: str = flt) -> None:
                self._strand.post(lambda: self._handler(flt, payload, flt) if self._handler else None)

            await self._client.subscribe_topic(flt, on_message)

    def publish(self, topic: str, payload: str) -> None:
        if self._client is not None:
            asyncio.get_event_loop().create_task(self._client.publish_event(topic, payload))


class SimVehicleApp(VehicleApp):
    """A Velocitas vehicle app running generated workflows on the SimVehicleApp runtime."""

    def __init__(self, app_name: str, binds: List[Callable[[Runtime], None]], trace_level: str = "node", on_app_start: Optional[Callable[[], None]] = None, on_app_stop: Optional[Callable[[], None]] = None) -> None:
        super().__init__()
        self.app_name = app_name
        self._binds = binds
        self._on_app_start = on_app_start
        self._on_app_stop = on_app_stop
        self.strand = Strand(MonotonicClock())
        self.sink = StdoutTraceSink(app_name, StdoutTraceSink.level_from_env(trace_level))
        self.runtime: Optional[Runtime] = None
        self._vehicle: Optional[VelocitasVehicleAccess] = None
        self._loop_task: Optional[asyncio.Task] = None
        self._stopping = False

    def _lifecycle(self, ev: str) -> None:
        self.sink.trace(TraceRecord(0, epoch_ms(), ev, "", None, "", "", None))

    async def on_start(self) -> None:
        self._vehicle = VelocitasVehicleAccess(self._vdb_client, self.strand)
        pubsub = VelocitasPubSub(self.pubsub_client, self.strand)
        self.runtime = Runtime(self.strand, self._vehicle, pubsub, self.sink)
        for bind in self._binds:
            bind(self.runtime)
        await self._vehicle.prefetch(self.runtime._path_type)
        self._lifecycle("vdb.connected")
        if self._on_app_start is not None:
            self._on_app_start()
        self.runtime.start()
        await pubsub.register()
        self._lifecycle("app.started")
        self._loop_task = asyncio.get_event_loop().create_task(self._run_strand())

    async def _run_strand(self) -> None:
        await self.strand.run()
        if self.runtime is not None and self.runtime.stopped and not self._stopping:
            # A `stop` block with scope "app" ended the strand: stop the whole app.
            await self.shutdown()
            asyncio.get_event_loop().stop()

    async def shutdown(self) -> None:
        """Stops every run and the strand, then the SDK (SIGTERM/SIGINT or a ``stop`` app block)."""
        if self._stopping:
            return
        self._stopping = True
        self._lifecycle("app.stopping")
        if self._on_app_stop is not None:
            self._on_app_stop()
        if self.runtime is not None:
            self.runtime.stop_all()
        self.strand.stop()
        if self._vehicle is not None:
            self._vehicle.close()
        try:
            await self.stop()
        except Exception as e:  # noqa: BLE001
            logger.debug("simvehicleapp: SDK stop: %s", e)
