"""Provider registry: exactly one owner per leaf path, outbound queue per provider."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from protobus.catalog import Catalog, CatalogError
from protobus.v1 import protobus_pb2 as pb


@dataclass(eq=False)
class ProviderConn:
    provider_id: str
    paths: frozenset[str]
    outbox: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=1024))

    def send(self, message: pb.BrokerMessage) -> None:
        try:
            self.outbox.put_nowait(message)
        except asyncio.QueueFull:  # a stuck provider must not block the broker; it is detached by its stream
            raise CatalogError("PB1404", f"provider {self.provider_id} is not draining its stream")


class Registry:
    def __init__(self, catalog: Catalog):
        self.catalog = catalog
        self.owners: dict[str, ProviderConn] = {}
        self.providers: dict[str, ProviderConn] = {}

    def attach(self, hello: pb.ProviderHello) -> ProviderConn:
        if hello.catalog_hash != self.catalog.hash:
            raise CatalogError("PB1001", f"provider {hello.provider_id} has catalog {hello.catalog_hash}")
        leaves = set(self.catalog.leaves())
        unknown = sorted(set(hello.owned_paths) - leaves)
        if unknown:
            raise CatalogError("PB1002", f"unknown paths {unknown[:5]}")
        taken = sorted(p for p in hello.owned_paths if p in self.owners)
        if taken or hello.provider_id in self.providers:
            raise CatalogError("PB1003", f"already owned: {taken[:5] or hello.provider_id}")
        conn = ProviderConn(hello.provider_id, frozenset(hello.owned_paths))
        self.providers[conn.provider_id] = conn
        for path in conn.paths:
            self.owners[path] = conn
        return conn

    def detach(self, conn: ProviderConn) -> list[str]:
        if self.providers.get(conn.provider_id) is not conn:
            return []
        del self.providers[conn.provider_id]
        for path in conn.paths:
            self.owners.pop(path, None)
        return sorted(conn.paths)

    def owner(self, path: str) -> ProviderConn:
        conn = self.owners.get(path)
        if conn is None:
            raise CatalogError("PB1403", f"no provider serves {path}")
        return conn

    def broadcast(self, message: pb.BrokerMessage) -> None:
        for conn in list(self.providers.values()):
            try:
                conn.send(message)
            except CatalogError:
                pass
