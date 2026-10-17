"""Scenario 1.1 expectations (ADR-0058 §9): subset, ``within``, ``never``; 1.0 stays exact — same as the simulator."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from simvehicleapp_runtime.testing import check_expectations, is_scenario_11  # noqa: E402

H = "Vehicle.Body.Lights.Hazard.IsSignaling"
L = "Vehicle.ADAS.LaneDepartureDetection.IsEnabled"


def result(writes, publishes=(), version="1.1.0"):
    return {"trace": [], "writes": [{"t": t, "path": p, "value": v} for t, p, v in writes], "publishes": [{"t": t, "topic": tp, "payload": pl} for t, tp, pl in publishes], "scenarioVersion": version}


def test_version():
    assert is_scenario_11("1.1.0") and is_scenario_11("1.2.3")
    assert not is_scenario_11("1.0.0") and not is_scenario_11("") and not is_scenario_11(None)


def test_subset_and_within():
    r = result([(0, L, False), (2010, H, True), (2500, H, False)])
    assert check_expectations(r, {"writes": [{"t": 2000, "path": H, "value": True, "within": 50}]}) == []
    assert len(check_expectations(r, {"writes": [{"t": 2000, "path": H, "value": True}]})) == 1
    assert len(check_expectations(r, {"writes": [{"t": 2020, "path": H, "value": True, "within": 100}]})) == 1
    exact = dict(r, scenarioVersion="1.0.0")
    assert len(check_expectations(exact, {"writes": [{"t": 2010, "path": H, "value": True}]})) == 1


def test_in_order_each_write_once():
    r = result([(100, H, True), (200, H, False)])
    assert check_expectations(r, {"writes": [{"t": 100, "path": H, "value": True}, {"t": 200, "path": H, "value": False}]}) == []
    assert len(check_expectations(r, {"writes": [{"t": 200, "path": H, "value": False}, {"t": 100, "path": H, "value": True}]})) == 1
    assert len(check_expectations(r, {"writes": [{"t": 100, "path": H, "value": True}, {"t": 100, "path": H, "value": True}]})) == 1


def test_never():
    r = result([(500, L, True)])
    assert check_expectations(r, {"never": [{"path": H}]}) == []
    assert check_expectations(r, {"never": [{"path": L, "from": 0, "to": 1000}]}) == [f"{L} must not be written in [0, 1000] ms: written true at 500 ms"]
    assert check_expectations(r, {"never": [{"path": L, "from": 600}]}) == []


def test_publishes():
    r = result([], [(1205, "app/hmi", '{"title":"Overspeed"}')])
    assert check_expectations(r, {"publishes": [{"t": 1200, "topic": "app/hmi", "payload": '{"title":"Overspeed"}', "within": 10}]}) == []
    assert len(check_expectations(r, {"publishes": [{"t": 1200, "topic": "app/hmi", "payload": "x", "within": 10}]})) == 1
