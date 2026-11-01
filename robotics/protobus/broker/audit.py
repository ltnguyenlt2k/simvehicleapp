"""Bounded audit trail: in-memory ring + optional rotating JSON-lines file (no secrets, ADR-0069 §8)."""
from __future__ import annotations

import collections
import json
import logging
import pathlib
import threading
import time


class AuditLog:
    def __init__(self, directory: str | None = None, max_bytes: int = 5 * 1024 * 1024, backups: int = 3, ring: int = 2000):
        self.ring: collections.deque = collections.deque(maxlen=ring)
        self.path = pathlib.Path(directory) / "audit.jsonl" if directory else None
        self.max_bytes, self.backups = max_bytes, backups
        self.lock = threading.Lock()
        self.file_error: str | None = None
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, kind: str, **fields) -> None:
        entry = {"t": time.time_ns(), "kind": kind, **fields}
        line = json.dumps(entry, sort_keys=True, default=str)
        with self.lock:
            self.ring.append(entry)
            if not self.path or self.file_error:
                return
            try:
                if self.path.exists() and self.path.stat().st_size + len(line) > self.max_bytes:
                    for index in range(self.backups - 1, 0, -1):
                        older = self.path.with_suffix(f".jsonl.{index}")
                        if older.exists():
                            older.replace(self.path.with_suffix(f".jsonl.{index + 1}"))
                    self.path.replace(self.path.with_suffix(".jsonl.1"))
                with self.path.open("a", encoding="utf-8") as stream:
                    stream.write(line + "\n")
            except OSError as error:  # auditing must never stop the control path; keep the in-memory ring
                self.file_error = str(error)
                logging.getLogger("protobus.audit").error("audit file disabled: %s", error)

    def recent(self, kind: str | None = None) -> list[dict]:
        with self.lock:
            return [e for e in self.ring if kind is None or e["kind"] == kind]
