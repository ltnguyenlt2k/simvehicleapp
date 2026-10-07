"""One strand of events ordered by (time, sequence) — the C++ runtime's ``Strand`` (ADR-0040 §2).

Without a clock it is virtual: ``run_until`` jumps from event to event (tests, conformance P1). With a clock
(``MonotonicClock``) ``run`` is an asyncio task that executes events when they are due; the Velocitas SDK
callbacks post on it from the same event loop, so everything the runtime does happens on one strand.
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import time
from typing import Callable, List, Optional, Set, Tuple


class MonotonicClock:
    """Milliseconds since the clock was created (steady, never jumps with the wall clock)."""

    def __init__(self) -> None:
        self._origin = time.monotonic()

    def now_ms(self) -> int:
        return int((time.monotonic() - self._origin) * 1000)


def epoch_ms() -> int:
    return int(time.time() * 1000)


class Strand:
    def __init__(self, clock: Optional[MonotonicClock] = None) -> None:
        self._clock = clock
        self._virtual_now = 0
        self._seq = itertools.count()
        self._heap: List[Tuple[int, int, Callable[[], None]]] = []
        self._cancelled: Set[int] = set()
        self._stopped = False
        self._events = 0
        self._wake: Optional[asyncio.Event] = None

    def now_ms(self) -> int:
        return self._clock.now_ms() if self._clock is not None else self._virtual_now

    def post(self, fn: Callable[[], None]) -> int:
        return self.post_at(self.now_ms(), fn)

    def post_at(self, at_ms: int, fn: Callable[[], None]) -> int:
        sid = next(self._seq)
        heapq.heappush(self._heap, (at_ms, sid, fn))
        if self._wake is not None:
            self._wake.set()
        return sid

    def cancel(self, sid: int) -> None:
        self._cancelled.add(sid)

    def _pop_due(self, limit: int) -> Optional[Callable[[], None]]:
        while self._heap and not self._stopped:
            if self._heap[0][0] > limit:
                return None
            at, sid, fn = heapq.heappop(self._heap)
            if sid in self._cancelled:
                self._cancelled.discard(sid)
                continue
            if self._clock is None and at > self._virtual_now:
                self._virtual_now = at
            self._events += 1
            return fn
        return None

    def run_until(self, until_ms: int) -> bool:
        """Virtual clock: every event up to ``until_ms``; False when the app stopped the strand."""
        while True:
            fn = self._pop_due(until_ms)
            if fn is None:
                break
            fn()
        if not self._stopped and self._clock is None and self._virtual_now < until_ms:
            self._virtual_now = until_ms
        return not self._stopped

    async def run(self) -> None:
        """Real clock: runs events when due until ``stop``."""
        self._wake = asyncio.Event()
        while True:
            fn = self._pop_due(self.now_ms())
            if fn is not None:
                fn()
                continue
            if self._stopped:
                return
            self._wake.clear()
            timeout = None
            if self._heap:
                timeout = max(0, self._heap[0][0] - self.now_ms()) / 1000
            try:
                await asyncio.wait_for(self._wake.wait(), timeout)
            except asyncio.TimeoutError:
                pass

    def stop(self) -> None:
        self._stopped = True
        if self._wake is not None:
            self._wake.set()

    @property
    def stopped(self) -> bool:
        return self._stopped

    @property
    def events(self) -> int:
        return self._events
