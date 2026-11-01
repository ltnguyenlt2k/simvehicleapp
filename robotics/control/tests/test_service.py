"""Control API against a real in-process broker + mock: auth, build, deploy, run, stop, integrity."""
import asyncio
import copy
import json
import pathlib

import httpx

from control.service import create_app
from protobus.tests.test_broker import stack
from rss import rssc

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMPLE = json.loads((ROOT / "robotflow" / "examples" / "greet-and-patrol.json").read_text())
SECRET = "unit-test-secret-0123456789"


def test_full_control_flow(tmp_path):
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_bytes(rssc.catalog_bytes(rssc.build("dog-go2-sim")))

    async def body():
        async with stack(str(catalog_file)) as s:
            s["mock"].model.marker_count = 1
            app = create_app(str(tmp_path / "data"), {"mock": (s["target"], s["safety_target"]),
                                                      "ros-sim": ("127.0.0.1:1", "127.0.0.1:1")}, SECRET, str(catalog_file))
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://rc", headers={"x-sv-internal": SECRET}) as c, \
                    httpx.AsyncClient(transport=transport, base_url="http://rc") as anonymous:
                assert (await anonymous.get("/blocks")).status_code == 401
                assert (await anonymous.get("/healthz")).status_code == 200
                bad = copy.deepcopy(EXAMPLE)
                bad["nodes"][3]["props"]["when"] = "Robot.Safety.Mode == \"MANUEL\""
                lint = (await c.post("/lint", json={"workflow": bad})).json()
                assert not lint["ok"] and lint["diagnostics"][0]["code"] == "RF2005"
                first = (await c.post("/builds", json={"workflow": EXAMPLE, "source": {"workflowId": "w1", "name": "Demo"}})).json()
                second = (await c.post("/builds", json={"workflow": EXAMPLE})).json()
                assert first["ok"] and first["build"]["id"] == second["build"]["id"]
                build_id = first["build"]["id"]
                code = await c.get(f"/builds/{build_id}/files/app/flow.py")
                assert "Robot.Motion.Perform" in code.text
                deployment = (await c.post("/deployments", json={"buildId": build_id, "mode": "mock"})).json()
                assert deployment["target"]["robotMode"] == "DISARMED" and deployment["target"]["providers"] == ["mock"]
                await asyncio.sleep(0.3)
                assert s["mock"].model.mode == "DISARMED"  # deploy never starts or arms
                unreachable = await c.post("/deployments", json={"buildId": build_id, "mode": "ros-sim"})
                assert unreachable.status_code == 503
                run = (await c.post("/runs", json={"deploymentId": deployment["id"]})).json()
                assert (await c.post("/runs", json={"deploymentId": deployment["id"]})).status_code == 409
                for _ in range(900):
                    view = (await c.get(f"/runs/{run['id']}")).json()
                    if view["state"] != "running":
                        break
                    await asyncio.sleep(0.1)
                assert view["state"] == "finished", view["events"][-5:]
                nodes = [e["node"] for e in view["events"] if e.get("ev") == "node" and e["state"] == "started"]
                assert nodes[:8] == ["hello", "arm", "battery", "see", "bow", "paw", "jump", "patrol"] and nodes[-2:] == ["done", "rest"]
                zip_response = await c.get(f"/deployments/{deployment['id']}/export")
                assert zip_response.status_code == 200 and len(zip_response.content) > 1000

                # Stop: start again, stop while running, robot-confirmed
                s["mock"].model.reset()
                s["mock"].model.marker_count = 1
                await asyncio.sleep(0.6)
                run = (await c.post("/runs", json={"deploymentId": deployment["id"]})).json()
                await asyncio.sleep(4)
                stopped = (await c.post(f"/runs/{run['id']}/stop")).json()
                assert stopped["state"] == "stopped" and stopped["stop"]["confirmed"]
                assert s["mock"].model.mode == "SAFE_STOP"

                # integrity: a modified artifact never runs
                flow = tmp_path / "data" / "builds" / build_id / "app" / "flow.py"
                flow.write_text(flow.read_text() + "\n# tampered\n")
                tampered = await c.post("/deployments", json={"buildId": build_id, "mode": "mock"})
                assert tampered.status_code == 409 and "modified" in tampered.json()["detail"]

    asyncio.run(body())
