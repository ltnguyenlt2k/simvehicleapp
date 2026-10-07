"""The "build" check of a Python project: the generated app loads and its signals match the project's VSS."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from simvehicleapp_runtime import check_project  # noqa: E402


def make(tmp_path, app_py: str):
    (tmp_path / "app" / "src" / "generated").mkdir(parents=True)
    (tmp_path / "app" / "vss").mkdir(parents=True)
    (tmp_path / ".velocitas.json").write_text(json.dumps({"variables": {"appManifestPath": "app/AppManifest.json"}}))
    (tmp_path / "app" / "AppManifest.json").write_text(json.dumps({"interfaces": [{"type": "vehicle-signal-interface", "config": {"src": "app/vss/vss.json"}}]}))
    vss = {"Vehicle": {"type": "branch", "children": {"Speed": {"type": "sensor", "datatype": "float"}, "Body": {"type": "branch", "children": {}}}}}
    (tmp_path / "app" / "vss" / "vss.json").write_text(json.dumps(vss))
    (tmp_path / "app" / "src" / "generated" / "__init__.py").write_text("")
    (tmp_path / "app" / "src" / "generated" / "app.py").write_text(app_py)
    for m in [m for m in sys.modules if m == "generated" or m.startswith("generated.")]:
        del sys.modules[m]
    return str(tmp_path)


def test_signals_match(tmp_path, capsys):
    p = make(tmp_path, 'WORKFLOWS = []\nSIGNALS = {"Vehicle.Speed": "float"}\n')
    assert check_project.main(["x", p]) == 0
    assert "1 signal(s) match app/vss/vss.json" in capsys.readouterr().out


def test_wrong_type_unknown_path_and_branch(tmp_path, capsys):
    p = make(tmp_path, 'WORKFLOWS = []\nSIGNALS = {"Vehicle.Speed": "double", "Vehicle.Nope": "boolean", "Vehicle.Body": "string"}\n')
    assert check_project.main(["x", p]) == 1
    out = capsys.readouterr().out.splitlines()
    assert out == [
        "error: Vehicle.Body is not a signal of the project's VSS (app/src/generated/app.py)",
        "error: Vehicle.Nope is not a signal of the project's VSS (app/src/generated/app.py)",
        "error: Vehicle.Speed is double in the workflows but float in the project's VSS",
    ]


def test_generated_app_that_does_not_load(tmp_path, capsys):
    p = make(tmp_path, "WORKFLOWS = [\n")
    assert check_project.main(["x", p]) == 1
    assert capsys.readouterr().out.startswith("error: the generated app does not load: SyntaxError")
