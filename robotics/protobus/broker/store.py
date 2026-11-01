"""Current values, quality (OK/STALE/UNAVAILABLE) and rate-limited latest-wins subscriptions."""
from __future__ import annotations

import asyncio
import time

from protobus.catalog import Catalog
from protobus.v1 import protobus_pb2 as pb

MAX_RATE_HZ = 50.0


class Subscription:
    def __init__(self, paths: list[str], rate_hz: float):
        self.paths = set(paths)
        self.period = 1.0 / max(0.1, min(rate_hz or 10.0, MAX_RATE_HZ))
        self.pending: dict[str, pb.Sample] = {}
        self.last_sent: dict[str, float] = {}
        self.wake = asyncio.Event()
        self.lagged = False
        self.closed = False

    def offer(self, sample: pb.Sample, now: float) -> None:
        if sample.path in self.pending:
            self.lagged = self.lagged or len(self.pending) > 4 * len(self.paths)
        self.pending[sample.path] = sample  # latest-wins
        due = self.last_sent.get(sample.path, 0.0) + self.period
        if now >= due:
            self.wake.set()
        else:
            loop = asyncio.get_running_loop()
            loop.call_at(loop.time() + (due - now), self.wake.set)

    def take(self, now: float) -> list[pb.Sample]:
        ready = [s for p, s in self.pending.items() if now >= self.last_sent.get(p, 0.0) + self.period - 1e-4]
        for sample in ready:
            del self.pending[sample.path]
            self.last_sent[sample.path] = now
        return ready


class Store:
    def __init__(self, catalog: Catalog):
        self.catalog = catalog
        self.samples: dict[str, pb.Sample] = {}
        self.received: dict[str, int] = {}  # monotonic ns
        self.stale_emitted: set[str] = set()
        self.subscriptions: set[Subscription] = set()
        self.max_age = {p: catalog.max_age_ns(p) for p in catalog.leaves()}

    def put(self, samples, now_ns: int | None = None) -> None:
        now_ns = now_ns or time.monotonic_ns()
        wall = time.time_ns()
        for sample in samples:
            sample.receive_time_ns = wall
            if sample.quality == pb.QUALITY_UNSPECIFIED:
                sample.quality = pb.OK
            self.samples[sample.path] = sample
            self.received[sample.path] = now_ns
            self.stale_emitted.discard(sample.path)
            self._fan_out(sample)

    def mark_unavailable(self, paths, reason: str = "provider detached") -> None:
        for path in paths:
            sample = pb.Sample(path=path, quality=pb.UNAVAILABLE, receive_time_ns=time.time_ns())
            self.samples[path] = sample
            self.received.pop(path, None)
            self._fan_out(sample)

    def current(self, path: str, now_ns: int | None = None) -> pb.Sample:
        sample = self.samples.get(path)
        if sample is None:
            return pb.Sample(path=path, quality=pb.UNAVAILABLE)
        if sample.quality == pb.OK and self._is_stale(path, now_ns or time.monotonic_ns()):
            stale = pb.Sample()
            stale.CopyFrom(sample)
            stale.quality = pb.STALE
            return stale
        return sample

    def _is_stale(self, path: str, now_ns: int) -> bool:
        limit = self.max_age.get(path)
        return bool(limit) and path in self.received and now_ns - self.received[path] > limit

    def sweep(self, now_ns: int | None = None) -> int:
        """Pushes one STALE sample when a value ages past maxAgeMs (workflows must see it)."""
        now_ns = now_ns or time.monotonic_ns()
        emitted = 0
        for path, sample in self.samples.items():
            if path not in self.stale_emitted and sample.quality == pb.OK and self._is_stale(path, now_ns):
                self.stale_emitted.add(path)
                self._fan_out(self.current(path, now_ns))
                emitted += 1
        return emitted

    def subscribe(self, paths: list[str], rate_hz: float, include_initial: bool) -> Subscription:
        sub = Subscription(paths, rate_hz)
        self.subscriptions.add(sub)
        if include_initial:
            now = time.monotonic()
            for path in paths:
                sub.pending[path] = self.current(path)
            sub.last_sent.update({p: now - sub.period for p in paths})
            sub.wake.set()
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        sub.closed = True
        self.subscriptions.discard(sub)

    def _fan_out(self, sample: pb.Sample) -> None:
        now = time.monotonic()
        for sub in self.subscriptions:
            if sample.path in sub.paths:
                sub.offer(sample, now)
