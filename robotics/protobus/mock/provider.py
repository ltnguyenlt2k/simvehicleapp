"""protobus-mock: the kinematic dog model served as a Protobus provider + an internal scenario API."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from protobus.catalog import Catalog
from protobus.mock.model import DogModel
from protobus.provider_client import ProviderClient
from protobus.v1 import protobus_pb2 as pb

TICK_HZ = 50
# Publish every N ticks: keeps each group fresher than its catalog maxAgeMs (IMU/legs 100 ms, pose 200 ms).
GROUP_EVERY = {"Robot.Imu.": 2, "Robot.Pose.": 2, "Robot.Velocity.": 2, "Robot.Leg.": 4,
               "Robot.PowerSystem.": 25, "Robot.Identity.": 50}
DEFAULT_EVERY = 5


def every(path: str) -> int:
    for prefix, n in GROUP_EVERY.items():
        if path.startswith(prefix):
            return n
    return DEFAULT_EVERY


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")
    atMs: int = Field(ge=0, le=3_600_000)
    set: dict[str, bool | int | float | str] = Field(max_length=32)


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timeline: list[Step] = Field(max_length=500)


class MockProvider:
    def __init__(self, catalog: Catalog, target: str, safety_target: str):
        self.catalog = catalog
        limits = catalog.node("Robot.Motion.Velocity")["fields"]
        self.model = DogModel(catalog.nodes["Robot.Identity.Id"].get("value", "dog1"),
                              (limits["LinearX"]["max"], limits["AngularZ"]["max"]))
        self.paths = [p for p in catalog.leaves(("sensor", "attribute")) if p in self.model.samples()]
        commands = catalog.leaves(("command", "setpoint"))
        self.client = ProviderClient(target, safety_target, "mock", catalog.hash, self.paths + commands, self)
        self.scenario: asyncio.Task | None = None
        self.ticks = 0

    # ------------------------------------------------------------ Handler

    async def on_command(self, request_id: str, path: str, args: dict, timeout_ms: int) -> None:
        self.model.command(request_id, path, args)
        self._flush_updates()

    async def on_cancel(self, request_id: str) -> None:
        self.model.cancel(request_id)
        self._flush_updates()

    async def on_setpoint(self, path: str, fields: dict, safe: bool, expires_in_ms: int) -> None:
        self.model.setpoint(fields.get("LinearX", 0.0), fields.get("AngularZ", 0.0))

    async def on_control(self, active: bool, lease_id: str) -> None:
        self.model.set_control(active)

    async def on_stop(self, request: pb.StopRequest) -> bool:
        self.model.stop(f"{request.source or 'WORKFLOW'} STOP")
        self._flush_updates()
        self.client.publish(self.model.samples())
        return self.model.mode == "SAFE_STOP"

    # ------------------------------------------------------------ loop

    def _flush_updates(self) -> None:
        while self.model.updates:
            request_id, phase, code, message = self.model.updates.pop(0)
            self.client.command_update(request_id, phase, code, message)

    async def run(self) -> None:
        period = 1 / TICK_HZ
        next_at = time.monotonic()
        asyncio.ensure_future(self.client.run())
        while True:
            self.model.tick(period)
            self._flush_updates()
            self.ticks += 1
            values = self.model.samples()
            self.client.publish({p: values[p] for p in self.paths if self.ticks % every(p) == 0})
            next_at += period
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))

    # ------------------------------------------------------------ scenario API

    def api(self) -> FastAPI:
        app = FastAPI(title="protobus-mock scenario API", version="1")

        @app.get("/health")
        def health():
            return {"ready": self.client.connected.is_set(), "safety": self.client.safety_connected.is_set(),
                    "catalogHash": self.catalog.hash}

        @app.get("/state")
        def state():
            m = self.model
            return {"mode": m.mode, "x": m.x, "y": m.y, "yaw": m.yaw, "soc": m.soc, "motion": m.motion_phase,
                    "mission": m.mission, "controller": m.controller, "time": m.time}

        @app.post("/reset")
        async def reset():
            if self.scenario:
                self.scenario.cancel()
            self.model.reset()
            return {"reset": True}

        @app.post("/scenario")
        async def scenario(body: Scenario):
            for step in body.timeline:
                for path in step.set:
                    node = self.catalog.nodes.get(path)
                    if node is None or node["kind"] != "sensor":
                        raise HTTPException(422, f"{path} is not a sensor of the catalog")
            if self.scenario:
                self.scenario.cancel()
            self.scenario = asyncio.ensure_future(self._play(body.timeline))
            return {"accepted": True, "steps": len(body.timeline)}

        return app

    async def _play(self, timeline: list[Step]) -> None:
        start = time.monotonic()
        for step in sorted(timeline, key=lambda s: s.atMs):
            await asyncio.sleep(max(0.0, start + step.atMs / 1000 - time.monotonic()))
            for path, value in step.set.items():
                self.model.apply(path, value)


def main() -> None:
    parser = argparse.ArgumentParser(prog="protobus-mock")
    parser.add_argument("--catalog", default=os.environ.get("PB_CATALOG", "/catalog/catalog.json"))
    parser.add_argument("--broker", default=os.environ.get("PB_BROKER", "protobus-broker:55500"))
    parser.add_argument("--safety", default=os.environ.get("PB_SAFETY", "protobus-broker:55501"))
    parser.add_argument("--api-port", type=int, default=int(os.environ.get("PB_MOCK_API_PORT", "8070")))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    mock = MockProvider(Catalog.load(args.catalog), args.broker, args.safety)

    async def run():
        server = uvicorn.Server(uvicorn.Config(mock.api(), host="0.0.0.0", port=args.api_port, log_level="warning"))
        await asyncio.gather(mock.run(), server.serve())

    asyncio.run(run())


if __name__ == "__main__":
    main()
