"""Build the example workflow and run the generated app as a separate process against broker + mock (M25-T07)."""
import asyncio
import json
import os
import pathlib
import sys

from robotflow.compiler import Compiler
from rss import rssc
from protobus.tests.test_broker import stack

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMPLE = json.loads((ROOT / "robotflow" / "examples" / "greet-and-patrol.json").read_text())


def write_app(tmp: pathlib.Path, files: dict) -> pathlib.Path:
    for name, text in files.items():
        path = tmp / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return tmp


async def run_app(app_dir, target, safety_target, timeout=90):
    env = {**os.environ, "PYTHONPATH": f"{app_dir}:{ROOT}", "PB_BROKER": target, "PB_SAFETY": safety_target, "RF_RUN_ID": "t"}
    proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "app.main", cwd=app_dir, env=env,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), timeout)
    events = [json.loads(line[8:]) for line in out.decode().splitlines() if line.startswith("RFTRACE ")]
    return proc.returncode, events, err.decode()


def started(events):
    return [e["node"] for e in events if e["ev"] == "node" and e["state"] == "started"]


def test_example_runs_with_correct_logic_on_mock(tmp_path):
    catalog = rssc.build("dog-go2-sim")
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_bytes(rssc.catalog_bytes(catalog))
    build = Compiler(catalog).build(EXAMPLE)
    assert build.ok
    app = write_app(tmp_path / "app-root", build.files)

    async def body():
        async with stack(str(catalog_file)) as s:
            s["mock"].model.marker_count = 1
            code, events, err = await run_app(app, s["target"], s["safety_target"])
            assert code == 0, err[-2000:]
            order = started(events)
            assert order == ["hello", "arm", "battery", "see", "bow", "paw", "jump",
                             "patrol", "out", "back", "patrol", "out", "back", "patrol", "done", "rest"], order
            commands = [(e["path"].rsplit(".", 1)[-1], e["phase"]) for e in events if e["ev"] == "command" and e["phase"] in ("SUCCEEDED", "FAILED", "REJECTED")]
            assert commands == [("Arm", "SUCCEEDED"), ("Perform", "SUCCEEDED"), ("Perform", "SUCCEEDED"), ("Perform", "SUCCEEDED"),
                                ("GoTo", "SUCCEEDED"), ("GoTo", "SUCCEEDED"), ("GoTo", "SUCCEEDED"), ("GoTo", "SUCCEEDED"),
                                ("Disarm", "SUCCEEDED")], commands
            logs = [e["message"] for e in events if e["ev"] == "log"]
            assert logs[0].startswith("Bắt đầu kịch bản, pin 92")
            final_x = float(logs[-1].split("x=")[1].split()[0])
            assert abs(final_x - 0.3) <= 0.2  # GoTo tolerance 0.15 m + one 20 Hz sample at 0.4 m/s
            assert s["mock"].model.mode == "DISARMED" and s["service"].control.lease is None

            # low battery: the else branch, no motion at all
            s["mock"].model.reset()
            s["mock"].model.soc = 15.0
            await asyncio.sleep(1.0)  # the mock publishes the battery group at 2 Hz, like a real slow sensor
            code, events, err = await run_app(app, s["target"], s["safety_target"])
            assert code == 0, err[-2000:]
            assert started(events) == ["hello", "arm", "battery", "low", "rest2"]
            assert not any(e["ev"] == "command" and "Perform" in e["path"] for e in events)

    asyncio.run(body())
