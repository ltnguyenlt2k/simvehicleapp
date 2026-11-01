"""rssc: schema, semantic, expansion, profile, determinism and diff checks (M22-T02…T04)."""
import copy
import json
import pathlib
import shutil

import pytest
import yaml

from rss import rssc

SPEC = rssc.SPEC_DIR


def make_spec(tmp_path: pathlib.Path, core_extra: dict | None = None, profile_patch: dict | None = None,
              drop: tuple[str, ...] = ()) -> pathlib.Path:
    root = tmp_path / "spec"
    shutil.copytree(SPEC, root)
    if core_extra is not None or drop:
        file = root / "core" / "zz-test.rss.yaml"
        for core in (root / "core").glob("*.rss.yaml"):
            data = yaml.safe_load(core.read_text())
            data["nodes"] = {k: v for k, v in data["nodes"].items() if k not in drop}
            core.write_text(yaml.safe_dump(data))
        if core_extra:
            file.write_text(yaml.safe_dump({"rss": "0.1", "kind": "core", "nodes": core_extra}))
    if profile_patch is not None:
        file = root / "profiles" / "dog-go2-sim.rss.yaml"
        data = yaml.safe_load(file.read_text())
        for key, value in profile_patch.items():
            if value is None:
                data.pop(key, None)
            else:
                data[key] = value
        file.write_text(yaml.safe_dump(data))
    return root


def codes(root: pathlib.Path) -> set[str]:
    with pytest.raises(rssc.RssError) as error:
        rssc.build("dog-go2-sim", root)
    return {d.code for d in error.value.diagnostics}


def test_real_spec_builds_and_matches_design_counts():
    catalog = rssc.build("dog-go2-sim")
    kinds = [n["kind"] for n in catalog["nodes"].values()]
    assert kinds.count("setpoint") == 1
    assert kinds.count("command") == 10
    assert sum(k != "branch" for k in kinds) == 101
    assert rssc.verify_hash(catalog)


def test_build_is_deterministic_bytes():
    assert rssc.catalog_bytes(rssc.build("dog-go2-sim")) == rssc.catalog_bytes(rssc.build("dog-go2-sim"))


def test_profile_narrows_velocity_to_brain_limits():
    fields = rssc.build("dog-go2-sim")["nodes"]["Robot.Motion.Velocity"]["fields"]
    assert (fields["LinearX"]["min"], fields["LinearX"]["max"]) == (-0.5, 0.5)
    assert (fields["AngularZ"]["min"], fields["AngularZ"]["max"]) == (-0.65, 0.65)


def test_instances_expand_vss_style():
    nodes = rssc.build("dog-go2-sim")["nodes"]
    assert "Robot.Leg.RearRight.Joint.Thigh.Effort" in nodes
    assert nodes["Robot.Leg.RearRight"]["kind"] == "branch"
    assert not any(p.startswith("Robot.Leg.Joint") or p == "Robot.Leg.IsInContact" for p in nodes)


def test_attributes_and_pending_are_applied():
    nodes = rssc.build("dog-go2-sim")["nodes"]
    assert nodes["Robot.Identity.Id"]["value"] == "dog1"
    assert "W2" in nodes["Robot.Motion.Perform"]["pending"]
    assert "pending" not in nodes["Robot.Pose.Position.X"]


@pytest.mark.parametrize("extra, code", [
    ({"Robot.Bad.Thing": {"kind": "sensor", "type": "bool", "maxAgeMs": 10, "description": "x"}}, "RS1003"),
    ({"Robot.Pose.Position.X.Sub": {"kind": "sensor", "type": "float64", "maxAgeMs": 10, "description": "x"}}, "RS1004"),
    ({"Robot.Pose.Speedish": {"kind": "sensor", "type": "float64", "unit": "furlong", "maxAgeMs": 10, "description": "x"}}, "RS1005"),
    ({"Robot.Pose.Ranged": {"kind": "sensor", "type": "float64", "min": 5, "max": 1, "maxAgeMs": 10, "description": "x"}}, "RS1006"),
    ({"Robot.Pose.Small": {"kind": "sensor", "type": "uint32", "min": -1, "maxAgeMs": 10, "description": "x"}}, "RS1006"),
    ({"Robot.Pose.Flag": {"kind": "sensor", "type": "bool", "maxAgeMs": 10, "description": "x"}}, "RS1010"),
    ({"Robot.Pose.Word": {"kind": "sensor", "type": "string", "unit": "m", "maxAgeMs": 10, "description": "x"}}, "RS1009"),
    ({"Robot.Pose.Choice": {"kind": "sensor", "type": "string", "values": ["A"], "maxAgeMs": 10, "description": "x"}}, "RS1009"),
    ({"Robot.Pose.NoAge": {"kind": "sensor", "type": "float64", "description": "x"}}, "RS1001"),
    ({"Robot.Pose.lowercase": {"kind": "sensor", "type": "float64", "maxAgeMs": 1, "description": "x"}}, "RS1001"),
    ({"Robot.Pose.Inst": {"kind": "sensor", "type": "float64", "maxAgeMs": 1, "instances": ["A"], "description": "x"}}, "RS1008"),
    ({"Robot.Motion.Push": {"kind": "setpoint", "description": "x", "fields": {"LinearX": {"type": "float64", "min": -1, "max": 1}},
                            "ttlMs": 100, "refreshHz": 10, "safeValue": {}}}, "RS1007"),
    ({"Robot.Motion.Push": {"kind": "setpoint", "description": "x", "fields": {"LinearX": {"type": "float64", "min": -1, "max": 1}},
                            "ttlMs": 100, "refreshHz": 10, "safeValue": {"LinearX": 5}}}, "RS1007"),
    ({"Robot.Motion.Push": {"kind": "setpoint", "description": "x", "fields": {"LinearX": {"type": "float64"}},
                            "ttlMs": 100, "refreshHz": 10}}, "RS1001"),
    ({"Robot.Motion.Go": {"kind": "command", "description": "x", "args": {}, "timeoutMs": 1, "results": ["OK"]}}, "RS1001"),
    ({"Robot.Motion.Halt": {"kind": "command", "description": "x", "args": {}, "timeoutMs": 1, "safetyLane": True,
                            "results": ["SUCCEEDED", "REJECTED"]}}, "RS1015"),
    ({"Robot.Motion.Route": {"kind": "command", "description": "x", "timeoutMs": 1, "results": ["SUCCEEDED"],
                             "args": {"Points": {"type": "array", "items": {"X": {"type": "float64"}}}}}}, "RS1009"),
    ({"Robot.Motion.Hit": {"kind": "command", "description": "x", "timeoutMs": 1, "results": ["SUCCEEDED"],
                           "args": {"speed": {"type": "float64"}}}}, "RS1001"),
])
def test_core_rejections(tmp_path, extra, code):
    assert code in codes(make_spec(tmp_path, core_extra=extra))


def test_duplicate_path_across_files_is_rejected(tmp_path):
    extra = {"Robot.Pose.Position.X": {"kind": "sensor", "type": "float64", "maxAgeMs": 1, "description": "dup"}}
    root = make_spec(tmp_path, core_extra=extra)
    with pytest.raises(rssc.RssError) as error:
        rssc.load_core(root)
    assert {d.code for d in error.value.diagnostics} == {"RS1002"}


@pytest.mark.parametrize("patch, code", [
    ({"include": ["Robot.Nothing.*"]}, "RS1011"),
    ({"narrow": {"Robot.Motion.Velocity": {"fields": {"LinearX": {"max": 3.0}}}}}, "RS1012"),
    ({"narrow": {"Robot.Motion.Velocity": {"fields": {"Sideways": {"max": 0.1}}}}}, "RS1012"),
    ({"narrow": {"Robot.Motion.Perform": {"args": {"Name": {"values": ["MOONWALK"]}}}}}, "RS1012"),
    ({"narrow": {"Robot.Motion.Velocity": {"ttlMs": 5}}}, "RS1012"),
    ({"narrow": {"Robot.Motion.Velocity": {"fields": {"LinearX": {"min": 0.1}}}}}, "RS1007"),
    ({"attributes": {"Robot.Identity.Backend": "MAYBE"}}, "RS1013"),
    ({"attributes": {"Robot.Pose.Position.X": 1}}, "RS1013"),
    ({"pending": {"Robot.Unknown.Path": "x"}}, "RS1014"),
    ({"extends": "other"}, "RS1001"),
])
def test_profile_rejections(tmp_path, patch, code):
    assert code in codes(make_spec(tmp_path, profile_patch=patch))


def test_profile_may_narrow_enum_subset(tmp_path):
    patch = {"narrow": {"Robot.Motion.Perform": {"args": {"Name": {"values": ["JUMP", "BOW"]}}}}}
    catalog = rssc.build("dog-go2-sim", make_spec(tmp_path, profile_patch=patch))
    assert catalog["nodes"]["Robot.Motion.Perform"]["args"]["Name"]["values"] == ["JUMP", "BOW"]


def test_hash_detects_tampering():
    catalog = rssc.build("dog-go2-sim")
    tampered = copy.deepcopy(catalog)
    tampered["nodes"]["Robot.Motion.Velocity"]["fields"]["LinearX"]["max"] = 2.0
    assert not rssc.verify_hash(tampered)


def test_diff_classifies_minor_and_major():
    old = rssc.build("dog-go2-sim")
    new = copy.deepcopy(old)
    new["nodes"]["Robot.Pose.Position.W"] = dict(new["nodes"]["Robot.Pose.Position.X"])
    assert rssc.diff(old, new)["level"] == "minor"
    new["nodes"]["Robot.Pose.Position.X"]["unit"] = "rad"
    result = rssc.diff(old, new)
    assert result["level"] == "major" and result["breaking"] == ["Robot.Pose.Position.X"]


def test_docs_cover_every_leaf():
    catalog = rssc.build("dog-go2-sim")
    pages = rssc.docs(catalog)
    text = "".join(pages.values())
    leaves = [p for p, n in catalog["nodes"].items() if n["kind"] != "branch"]
    assert all(f"`{p}`" in text for p in leaves)
    assert "Pending: dog R4 W2" in pages["Motion.md"]


def test_catalog_schema_rejects_unknown_kind():
    catalog = rssc.build("dog-go2-sim")
    catalog["nodes"]["Robot.Pose.Position.X"]["kind"] = "actuator"
    validator = rssc._schema("rss-catalog.v1.json")
    assert list(validator.iter_errors(json.loads(json.dumps(catalog))))


def test_every_emitted_code_is_in_the_public_catalog():
    import re
    source = pathlib.Path(rssc.__file__).read_text()
    emitted = set(re.findall(r'"(RS\d{4})"', source))
    catalog = json.loads((pathlib.Path(rssc.__file__).parents[1] / "contracts" / "diagnostics.v1.json").read_text())
    assert emitted and emitted <= set(catalog["codes"])
