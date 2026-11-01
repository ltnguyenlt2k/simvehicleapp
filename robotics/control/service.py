"""robotics-control: build / deploy / run API used only by the studio BFF (ADR-0068 §4, ADR-0069).

- Internal only: every route except /healthz needs the header x-sv-internal == RC_INTERNAL_SECRET.
- Build = rflowc output stored immutably by artifact hash. Deploy = bind a build to an observed target
  (mode mock | ros-sim); it never starts or arms. Run = explicit start of the verified artifact as a child
  process with resource limits; one run per mode. Stop = safety lane (robot-confirmed) then terminate.
- The browser never chooses an execution URL or sends code: modes map to fixed broker addresses.
"""
from __future__ import annotations

import asyncio
import collections
import hashlib
import hmac
import io
import json
import os
import pathlib
import shutil
import signal
import time
import uuid
import zipfile
from typing import Literal

import grpc
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from robotflow.compiler import Compiler, canonical, load_registry, sha

Mode = Literal["mock", "ros-sim"]
ROOT = pathlib.Path(__file__).resolve().parents[1]


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(Closed):
    workflowId: str = Field(default="", max_length=128)
    name: str = Field(default="", max_length=200)


class LintInput(Closed):
    workflow: dict
    mode: Mode = "mock"


class BuildInput(LintInput):
    source: Source = Source()


class DeployInput(Closed):
    buildId: str = Field(pattern=r"^[0-9a-f]{16,64}$")
    mode: Mode


class RunInput(Closed):
    deploymentId: str = Field(pattern=r"^[0-9a-f-]{36}$")


class Run:
    def __init__(self, run_id: str, deployment: dict, process: asyncio.subprocess.Process):
        self.id, self.deployment, self.process = run_id, deployment, process
        self.started = time.time()
        self.events: collections.deque = collections.deque(maxlen=4000)
        self.seq = 0
        self.state = "running"
        self.exit_code: int | None = None
        self.stop_result: dict | None = None

    def add(self, event: dict) -> None:
        self.seq += 1
        self.events.append({"seq": self.seq, **event})

    def view(self, after: int = 0) -> dict:
        return {"id": self.id, "deploymentId": self.deployment["id"], "mode": self.deployment["mode"],
                "buildId": self.deployment["buildId"], "state": self.state, "exitCode": self.exit_code,
                "startedAt": self.started, "stop": self.stop_result,
                "events": [e for e in self.events if e["seq"] > after][-1000:], "latestSeq": self.seq}


def create_app(data_dir: str | None = None, brokers: dict | None = None, secret: str | None = None,
               catalog_path: str | None = None) -> FastAPI:
    data = pathlib.Path(data_dir or os.environ.get("RC_DATA_DIR", "/data"))
    (data / "builds").mkdir(parents=True, exist_ok=True)
    (data / "deployments").mkdir(parents=True, exist_ok=True)
    secret = secret if secret is not None else os.environ.get("RC_INTERNAL_SECRET", "")
    if len(secret) < 16:
        raise RuntimeError("RC_INTERNAL_SECRET (≥ 16 chars) is required")
    brokers = brokers or {
        "mock": (os.environ.get("RC_MOCK_BROKER", "protobus-broker:55500"), os.environ.get("RC_MOCK_SAFETY", "protobus-broker:55501")),
        "ros-sim": (os.environ.get("RC_ROS_BROKER", "protobus-broker-ros:55500"), os.environ.get("RC_ROS_SAFETY", "protobus-broker-ros:55501")),
    }
    catalog = json.loads(pathlib.Path(catalog_path or os.environ.get("PB_CATALOG", "/catalog/catalog.json")).read_text())
    registry = load_registry()
    runs: dict[str, Run] = {}
    active: dict[str, Run] = {}
    app = FastAPI(title="robotics-control", version="0.1.0")
    zoo_url = os.environ.get("RC_ZOO_URL", "http://127.0.0.1:8090")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.url.path != "/healthz":
            supplied = request.headers.get("x-sv-internal", "")
            if not hmac.compare_digest(supplied, secret):
                return JSONResponse({"error": "internal callers only"}, status_code=401)
        return await call_next(request)

    def compiler(mode: str) -> Compiler:
        return Compiler(catalog, registry, mode)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "catalogHash": catalog["catalogHash"], "activeRuns": sorted(active)}

    @app.get("/blocks")
    def blocks():
        return registry

    @app.get("/catalog")
    def rss_catalog():
        return catalog

    @app.get("/config")
    def config():
        return {"zooUrl": zoo_url, "modes": ["mock", "ros-sim"], "profile": catalog["profile"]}

    @app.post("/lint")
    def lint(body: LintInput):
        result = compiler(body.mode).lint(body.workflow)
        return {"ok": result.ok, "diagnostics": [d.as_dict() for d in result.diagnostics]}

    @app.post("/builds")
    def build(body: BuildInput):
        result = compiler(body.mode).build(body.workflow)
        diagnostics = [d.as_dict() for d in result.diagnostics]
        if not result.ok:
            return {"ok": False, "diagnostics": diagnostics}
        lock = json.loads(result.files["rflow.lock.json"])
        build_id = lock["artifactHash"].split(":")[1][:24]
        folder = data / "builds" / build_id
        if not folder.exists():
            temporary = data / "builds" / f".tmp-{uuid.uuid4().hex}"
            for name, text in result.files.items():
                path = temporary / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            (temporary / "build.json").write_text(json.dumps({
                "id": build_id, "artifactHash": lock["artifactHash"], "mode": body.mode, "source": body.source.model_dump(),
                "createdAt": time.time(), "lock": lock}, indent=1))
            os.rename(temporary, folder)
        record = json.loads((folder / "build.json").read_text())
        return {"ok": True, "diagnostics": diagnostics,
                "build": {**{k: record[k] for k in ("id", "artifactHash", "createdAt", "source")},
                          "files": sorted(result.files), "signals": result.ir["signals"]}}

    def load_build(build_id: str) -> tuple[pathlib.Path, dict]:
        folder = data / "builds" / build_id
        if not (folder / "build.json").is_file():
            raise HTTPException(404, "build not found")
        record = json.loads((folder / "build.json").read_text())
        lock = record["lock"]
        for name, digest in lock["files"].items():  # integrity before every use
            if sha((folder / name).read_bytes()) != digest:
                raise HTTPException(409, f"artifact file {name} was modified")
        if sha(canonical({k: v for k, v in lock.items() if k != "artifactHash"})) != lock["artifactHash"]:
            raise HTTPException(409, "artifact lock was modified")
        return folder, record

    @app.get("/builds/{build_id}/files/{name:path}")
    def build_file(build_id: str, name: str):
        folder, record = load_build(build_id)
        if name not in record["lock"]["files"] and name != "rflow.lock.json":
            raise HTTPException(404, "no such file")
        return Response((folder / name).read_text(), media_type="text/plain; charset=utf-8")

    async def target(mode: str) -> dict:
        broker, _ = brokers[mode]
        try:
            async with grpc.aio.insecure_channel(broker) as channel:
                stub = rpc.BrokerStub(channel)
                health = await stub.Health(pb.HealthRequest(), timeout=3)
                values = await stub.Get(pb.GetRequest(paths=["Robot.Identity.Id", "Robot.Safety.Mode", "Robot.Simulation.SceneId",
                                                             "Robot.Connection.IsOnline"]), timeout=3)
        except grpc.aio.AioRpcError as error:
            raise HTTPException(503, f"{mode} robot bus unavailable: {error.code().name}")
        from protobus.wire import from_value
        observed = {s.path: from_value(s.value) for s in values.samples if s.quality == pb.OK}
        return {"mode": mode, "catalogHash": health.catalog_hash, "providers": list(health.providers),
                "robotId": observed.get("Robot.Identity.Id"), "robotMode": observed.get("Robot.Safety.Mode"),
                "scene": observed.get("Robot.Simulation.SceneId"), "online": observed.get("Robot.Connection.IsOnline")}

    @app.get("/targets/{mode}")
    async def get_target(mode: Mode):
        return await target(mode)

    @app.post("/deployments")
    async def deploy(body: DeployInput):
        folder, record = load_build(body.buildId)
        observed = await target(body.mode)
        if observed["catalogHash"] != record["lock"]["catalogHash"]:
            raise HTTPException(409, "the robot catalog differs from the build; rebuild")
        if body.mode == "ros-sim" and not any(p.startswith("ros2-") for p in observed["providers"]):
            raise HTTPException(409, "the ROS 2 bridge is not attached to the robot bus")
        if body.mode == "ros-sim":
            result = compiler("ros-sim").lint(json.loads((folder / "workflow.json").read_text()))
            if not result.ok:
                raise HTTPException(409, "workflow uses interfaces not available on the ROS robot: "
                                    + "; ".join(d.message for d in result.diagnostics if d.severity == "error"))
        deployment = {"id": str(uuid.uuid4()), "buildId": body.buildId, "artifactHash": record["artifactHash"],
                      "mode": body.mode, "target": observed, "createdAt": time.time(), "source": record["source"]}
        (data / "deployments" / f"{deployment['id']}.json").write_text(json.dumps(deployment, indent=1))
        return deployment

    def load_deployment(deployment_id: str) -> dict:
        path = data / "deployments" / f"{deployment_id}.json"
        if not path.is_file():
            raise HTTPException(404, "deployment not found")
        return json.loads(path.read_text())

    @app.get("/deployments/{deployment_id}/export")
    def export(deployment_id: str):
        deployment = load_deployment(deployment_id)
        folder, record = load_build(deployment["buildId"])
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(record["lock"]["files"]) + ["rflow.lock.json"]:
                archive.writestr(name, (folder / name).read_text())
            archive.writestr("deployment.json", json.dumps(deployment, indent=1))
        return Response(buffer.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="robot-workflow-{deployment["buildId"]}.zip"'})

    async def pump(run: Run) -> None:
        assert run.process.stdout is not None
        async for raw in run.process.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            if line.startswith("RFTRACE "):
                try:
                    run.add(json.loads(line[8:]))
                    continue
                except ValueError:
                    pass
            if line:
                run.add({"ev": "stdout", "message": line[:500]})
        run.exit_code = await run.process.wait()
        if run.state == "running":
            run.state = "finished" if run.exit_code == 0 else "failed"
        if active.get(run.deployment["mode"]) is run:
            del active[run.deployment["mode"]]

    @app.post("/runs")
    async def start(body: RunInput):
        deployment = load_deployment(body.deploymentId)
        mode = deployment["mode"]
        if mode in active and active[mode].state == "running":
            raise HTTPException(409, f"a run is already active on {mode}; stop it first")
        folder, _ = load_build(deployment["buildId"])
        run_id = str(uuid.uuid4())
        workdir = pathlib.Path("/tmp") / "runs" / run_id
        shutil.copytree(folder, workdir)
        broker, safety = brokers[mode]
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONPATH": f"{workdir}:{ROOT}",
               "PB_BROKER": broker, "PB_SAFETY": safety, "RF_RUN_ID": run_id, "PYTHONUNBUFFERED": "1",
               "PYTHONDONTWRITEBYTECODE": "1"}
        process = await asyncio.create_subprocess_exec("python", "-m", "control.launch", cwd=workdir, env=env,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                                                       start_new_session=True)
        run = Run(run_id, deployment, process)
        runs[run_id] = active[mode] = run
        if len(runs) > 50:
            for old in [r for r in runs.values() if r.state != "running"][:10]:
                runs.pop(old.id, None)
        asyncio.ensure_future(pump(run))
        return run.view()

    @app.get("/runs/{run_id}")
    def run_status(run_id: str, after: int = 0):
        run = runs.get(run_id)
        if run is None:
            raise HTTPException(404, "run not found")
        return run.view(after)

    @app.get("/runs")
    def run_list():
        return {"runs": [{k: v for k, v in r.view().items() if k != "events"} for r in runs.values()]}

    @app.post("/runs/{run_id}/stop")
    async def stop(run_id: str):
        run = runs.get(run_id)
        if run is None:
            raise HTTPException(404, "run not found")
        _, safety = brokers[run.deployment["mode"]]
        try:
            async with grpc.aio.insecure_channel(safety) as channel:
                result = await rpc.SafetyLaneStub(channel).Stop(
                    pb.StopRequest(request_id=str(uuid.uuid4()), source="CONTROL", reason="Stop pressed in the studio"), timeout=3)
            run.stop_result = {"confirmed": result.confirmed, "code": result.code, "message": result.message,
                               "requestId": result.request_id}
        except grpc.aio.AioRpcError as error:
            run.stop_result = {"confirmed": False, "code": "PB1502", "message": error.code().name}
        if run.process.returncode is None:
            run.state = "stopped"
            try:
                os.killpg(run.process.pid, signal.SIGTERM)
                await asyncio.wait_for(run.process.wait(), 3)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    os.killpg(run.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        run.add({"ev": "stop", **run.stop_result})
        return run.view()

    return app


def main() -> None:
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("RC_PORT", "4600")), log_level="warning")


if __name__ == "__main__":
    main()
