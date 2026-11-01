"""Control authority: one lease per robot, setpoints with TTL → safeValue, command lifecycle (ADR-0066/0069)."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from protobus.broker.audit import AuditLog
from protobus.broker.providers import ProviderConn, Registry
from protobus.catalog import Catalog, CatalogError
from protobus.v1 import protobus_pb2 as pb
from protobus.wire import TERMINAL, from_struct, to_struct

LEASE_TTL_MS = 1000


@dataclass
class LeaseState:
    lease_id: str
    client_id: str
    expires: float  # monotonic seconds


@dataclass(eq=False)
class ActiveCommand:
    request_id: str
    path: str
    lease_id: str
    provider: ProviderConn
    updates: asyncio.Queue = field(default_factory=asyncio.Queue)
    done: bool = False


def update(request_id: str, path: str, phase: int, code: str = "", message: str = "") -> pb.CommandUpdate:
    return pb.CommandUpdate(request_id=request_id, path=path, phase=phase, code=code, message=message,
                            time_ns=time.time_ns())


class Control:
    def __init__(self, catalog: Catalog, registry: Registry, audit: AuditLog):
        self.catalog, self.registry, self.audit = catalog, registry, audit
        self.lease: LeaseState | None = None
        self.setpoint_timers: dict[str, asyncio.TimerHandle] = {}
        self.setpoint_active: set[str] = set()
        self.commands: dict[str, ActiveCommand] = {}
        self.seen_requests: dict[str, float] = {}

    # ------------------------------------------------------------ lease

    def acquire(self, client_id: str) -> pb.Lease:
        self.expire_lease_if_due()
        if self.lease is not None:
            raise CatalogError("PB1202", f"control held by {self.lease.client_id}")
        self.lease = LeaseState(str(uuid.uuid4()), client_id[:96] or "anonymous", time.monotonic() + LEASE_TTL_MS / 1000)
        self.audit.record("lease.acquire", lease=self.lease.lease_id, client=self.lease.client_id)
        self.registry.broadcast(pb.BrokerMessage(control=pb.ControlState(active=True, lease_id=self.lease.lease_id)))
        return pb.Lease(lease_id=self.lease.lease_id, ttl_ms=LEASE_TTL_MS)

    def check(self, lease_id: str) -> LeaseState:
        self.expire_lease_if_due()
        if self.lease is None or lease_id != self.lease.lease_id:
            raise CatalogError("PB1201", "a valid control lease is required")
        self.lease.expires = time.monotonic() + LEASE_TTL_MS / 1000  # every valid use renews
        return self.lease

    def renew(self, lease_id: str) -> pb.Lease:
        self.check(lease_id)
        return pb.Lease(lease_id=lease_id, ttl_ms=LEASE_TTL_MS)

    def release(self, lease_id: str) -> bool:
        if self.lease is None or self.lease.lease_id != lease_id:
            return False
        self.end_lease("released")
        return True

    def expire_lease_if_due(self) -> None:
        if self.lease is not None and time.monotonic() > self.lease.expires:
            self.end_lease("expired")

    def end_lease(self, reason: str) -> None:
        lease = self.lease
        if lease is None:
            return
        self.lease = None
        self.audit.record("lease.end", lease=lease.lease_id, reason=reason)
        for path in sorted(self.setpoint_active):
            self._send_safe(path, reason)
        for command in list(self.commands.values()):
            if command.lease_id == lease.lease_id and not command.done:
                self._cancel_on_provider(command)
                self.finish(command, pb.CANCELLED, "PB1406", f"control lease {reason}")
        self.registry.broadcast(pb.BrokerMessage(control=pb.ControlState(active=False)))

    # ------------------------------------------------------------ setpoints

    def setpoint(self, lease_id: str, path: str, fields: dict[str, float]) -> pb.SetpointAck:
        self.check(lease_id)
        values = self.catalog.check_setpoint(path, fields)
        ttl = self.catalog.node(path)["ttlMs"]
        owner = self.registry.owner(path)
        owner.send(pb.BrokerMessage(setpoint=pb.SetpointDispatch(path=path, fields=values, expires_in_ms=ttl)))
        if path not in self.setpoint_active:
            self.audit.record("setpoint.start", path=path, fields=values)
        self.setpoint_active.add(path)
        timer = self.setpoint_timers.pop(path, None)
        if timer:
            timer.cancel()
        self.setpoint_timers[path] = asyncio.get_running_loop().call_later(ttl / 1000, self._send_safe, path, "ttl")
        return pb.SetpointAck(accepted=True, expires_in_ms=ttl)

    def _send_safe(self, path: str, reason: str) -> None:
        timer = self.setpoint_timers.pop(path, None)
        if timer:
            timer.cancel()
        if path not in self.setpoint_active:
            return
        self.setpoint_active.discard(path)
        self.audit.record("setpoint.safe", path=path, reason=reason)
        try:
            self.registry.owner(path).send(pb.BrokerMessage(setpoint=pb.SetpointDispatch(
                path=path, fields=self.catalog.safe_value(path), safe=True)))
        except CatalogError:
            pass  # provider gone: the robot's own watchdog stops the body

    # ------------------------------------------------------------ commands

    async def execute(self, request: pb.CommandRequest):
        node = self.catalog.node(request.path, "command")
        args = from_struct(request.args)
        self.catalog.check_args(request.path, args)
        lease = self.check(request.lease_id)
        if not request.request_id or len(request.request_id) > 64:
            raise CatalogError("PB1401", "request_id (≤ 64 chars) is required")
        if request.request_id in self.seen_requests:
            raise CatalogError("PB1402", f"duplicate request_id {request.request_id}")
        self.seen_requests[request.request_id] = time.monotonic()
        if len(self.seen_requests) > 5000:
            for key in sorted(self.seen_requests, key=self.seen_requests.get)[:1000]:
                del self.seen_requests[key]
        owner = self.registry.owner(request.path)
        command = ActiveCommand(request.request_id, request.path, lease.lease_id, owner)
        self.commands[command.request_id] = command
        self.audit.record("command.dispatch", request_id=command.request_id, path=command.path, args=args)
        owner.send(pb.BrokerMessage(command=pb.CommandDispatch(
            request_id=command.request_id, path=command.path, args=to_struct(args), timeout_ms=node["timeoutMs"])))
        deadline = time.monotonic() + node["timeoutMs"] / 1000
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 and not command.done:
                    self._cancel_on_provider(command)
                    self.finish(command, pb.TIMED_OUT, "PB1405", "catalog timeout reached")
                try:
                    item = await asyncio.wait_for(command.updates.get(), timeout=max(remaining, 0.05))
                except asyncio.TimeoutError:
                    continue
                yield item
                if item.phase in TERMINAL:
                    return
        finally:
            command.done = True
            self.commands.pop(command.request_id, None)

    def on_provider_update(self, conn: ProviderConn, item: pb.CommandUpdate) -> None:
        command = self.commands.get(item.request_id)
        if command is None or command.provider is not conn or command.done:
            return
        item.path = command.path
        if item.phase in TERMINAL:
            self.finish(command, item.phase, item.code, item.message)
        else:
            command.updates.put_nowait(item)

    def finish(self, command: ActiveCommand, phase: int, code: str = "", message: str = "") -> None:
        if command.done:
            return
        command.done = True
        self.audit.record("command.result", request_id=command.request_id, path=command.path,
                          phase=pb.CommandPhase.Name(phase), code=code, message=message)
        command.updates.put_nowait(update(command.request_id, command.path, phase, code, message))

    def cancel(self, lease_id: str, request_id: str) -> pb.CommandUpdate:
        self.check(lease_id)
        command = self.commands.get(request_id)
        if command is None or command.done:
            raise CatalogError("PB1401", f"no active command {request_id}")
        self._cancel_on_provider(command)
        return update(request_id, command.path, pb.RUNNING, "", "cancel requested")

    def _cancel_on_provider(self, command: ActiveCommand) -> None:
        try:
            command.provider.send(pb.BrokerMessage(cancel=pb.CancelDispatch(request_id=command.request_id)))
        except CatalogError:
            pass

    def on_provider_lost(self, conn: ProviderConn) -> None:
        for command in list(self.commands.values()):
            if command.provider is conn:
                self.finish(command, pb.FAILED, "PB1404", "provider disconnected")
        for path in list(self.setpoint_active):
            if path in conn.paths:
                self.setpoint_active.discard(path)
                timer = self.setpoint_timers.pop(path, None)
                if timer:
                    timer.cancel()

    def on_stop(self, source: str) -> None:
        """Called on the main loop after a safety-lane stop: control ends, setpoints go safe."""
        self.end_lease(f"stop by {source}")
        for path in sorted(self.setpoint_active):
            self._send_safe(path, "stop")
