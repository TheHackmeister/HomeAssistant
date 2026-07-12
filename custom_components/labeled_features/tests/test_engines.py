"""Unit tests for the features + areas engines.

Uses a hand-rolled fake ``hass`` and monkeypatched ``labels`` registry helpers
so the reducers can be exercised without a full Home Assistant runtime.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.labeled_features import areas_state, features_state
from custom_components.labeled_features import labels as reg
from custom_components.labeled_features.features_state import (
    FeaturesEngine,
    FeaturesSnapshot,
)


class FakeState:
    def __init__(self, entity_id, state, attributes=None, last_changed=None):
        self.entity_id = entity_id
        self.state = state
        self.attributes = attributes or {}
        self.last_changed = last_changed or datetime.now(timezone.utc)


class FakeStates:
    def __init__(self):
        self._d: dict[str, FakeState] = {}

    def set(self, st: FakeState):
        self._d[st.entity_id] = st

    def get(self, entity_id):
        return self._d.get(entity_id)


class FakeHass:
    def __init__(self):
        self.states = FakeStates()


@pytest.fixture
def fake_registry(monkeypatch):
    """Install a controllable fake registry over the labels helper module."""
    store = {
        "entity_labels": {},   # entity_id -> [label names]
        "area_labels": {},     # area_id -> [label names]
        "entity_area": {},     # entity_id -> area_id
        "area_floor": {},      # area_id -> floor_id
        "label_entities": {},  # label name -> [entity_ids]
        "label_areas": {},     # label name -> [area_ids]
    }

    monkeypatch.setattr(
        reg, "entity_label_names",
        lambda hass, eid: store["entity_labels"].get(eid, []),
    )
    monkeypatch.setattr(
        reg, "area_label_names",
        lambda hass, aid: store["area_labels"].get(aid, []),
    )
    monkeypatch.setattr(
        reg, "entity_area_id",
        lambda hass, eid: store["entity_area"].get(eid),
    )
    monkeypatch.setattr(
        reg, "floor_of_area",
        lambda hass, aid: store["area_floor"].get(aid),
    )
    monkeypatch.setattr(
        reg, "entities_with_label_name",
        lambda hass, name: store["label_entities"].get(name, []),
    )
    monkeypatch.setattr(
        reg, "areas_with_label_name",
        lambda hass, name: store["label_areas"].get(name, []),
    )
    return store


def test_features_leader_mode_enables(fake_registry):
    hass = FakeHass()
    store = fake_registry
    eid = "binary_sensor.front_door"
    store["label_entities"]["feature_leader"] = [eid]
    store["entity_labels"][eid] = ["Leader: Open Door"]
    store["entity_area"][eid] = "entry"
    hass.states.set(FakeState(eid, "on"))

    engine = FeaturesEngine(hass, "feature_leader", "sensor.labeled_features_state")
    new_state = FakeState(eid, "on")
    snap = engine.reduce_state_changed(FeaturesSnapshot(), eid, new_state)

    entry = snap.features["Open Door"]["global"][""]
    assert entry["enabled"] is True
    assert entry["mode"] == "leader"
    assert entry["triggering_leader"] == eid


def test_features_invert(fake_registry):
    hass = FakeHass()
    store = fake_registry
    eid = "binary_sensor.motion"
    store["label_entities"]["feature_leader"] = [eid]
    store["entity_labels"][eid] = ["Leader: Night", "Night Invert: True"]
    hass.states.set(FakeState(eid, "on"))

    engine = FeaturesEngine(hass, "feature_leader", "sensor.labeled_features_state")
    snap = engine.reduce_state_changed(
        FeaturesSnapshot(), eid, FakeState(eid, "on")
    )
    assert snap.features["Night"]["global"][""]["enabled"] is False


def test_features_enable_label_value(fake_registry):
    hass = FakeHass()
    store = fake_registry
    eid = "input_select.house_mode"
    store["label_entities"]["feature_leader"] = [eid]
    store["entity_labels"][eid] = ["Leader: Night", "Night Enable: Sleeping"]
    hass.states.set(FakeState(eid, "Sleeping"))

    engine = FeaturesEngine(hass, "feature_leader", "sensor.labeled_features_state")
    snap = engine.reduce_state_changed(
        FeaturesSnapshot(), eid, FakeState(eid, "Sleeping")
    )
    assert snap.features["Night"]["global"][""]["enabled"] is True


def test_manual_override_sets_feature(fake_registry):
    hass = FakeHass()
    fake_registry["label_entities"]["feature_leader"] = []
    engine = FeaturesEngine(hass, "feature_leader", "sensor.labeled_features_state")
    snap = engine.reduce_manual_set(
        FeaturesSnapshot(),
        {
            "target_feature": "Screen",
            "scope": "area",
            "scope_id": "tv_room",
            "enabled": True,
            "timestamp": 100.0,
        },
    )
    entry = snap.features["Screen"]["area"]["tv_room"]
    assert entry["enabled"] is True
    assert entry["triggering_leader"] == ""
    assert entry["last_changed_timestamp"] == 100.0


def test_snapshot_set_and_clear(fake_registry):
    hass = FakeHass()
    engine = FeaturesEngine(hass, "feature_leader", "sensor.labeled_features_state")
    snap = engine.reduce_snapshot_set(
        FeaturesSnapshot(),
        {"snapshot_name": "sleep_timeout", "payload": {"volume": 0.4}},
    )
    assert snap.snapshots["sleep_timeout"] == {"volume": 0.4}

    cleared = engine.reduce_snapshot_set(
        snap, {"snapshot_name": "sleep_timeout", "payload": {}}
    )
    assert "sleep_timeout" not in cleared.snapshots


def test_area_label_map_area_scope(fake_registry):
    hass = FakeHass()
    store = fake_registry
    store["label_areas"]["feature_leader"] = ["tv_room"]
    store["area_labels"]["tv_room"] = ["Area Provides: Audio Mode"]
    store["area_floor"]["tv_room"] = "first_floor"

    lm = areas_state.build_label_map(hass, "feature_leader")
    key = "tv_room||Audio Mode"
    assert key in lm
    assert lm[key]["scope"] == "area"
    assert lm[key]["scope_id"] == "tv_room"
    assert lm[key]["component"] == "select"
    assert lm[key]["declaring_area_id"] == "tv_room"


def test_area_label_map_component_override(fake_registry):
    hass = FakeHass()
    store = fake_registry
    store["label_areas"]["feature_leader"] = ["grow"]
    store["area_labels"]["grow"] = [
        "Area Provides: Root Zone",
        "Area Provides Root Zone Component: number",
    ]
    lm = areas_state.build_label_map(hass, "feature_leader")
    assert lm["grow||Root Zone"]["component"] == "number"


def test_area_label_map_floor_dedup(fake_registry):
    hass = FakeHass()
    store = fake_registry
    store["label_areas"]["feature_leader"] = ["kitchen", "dining"]
    store["area_labels"]["kitchen"] = ["Floor Provides: House Mode"]
    store["area_labels"]["dining"] = ["Floor Provides: House Mode"]
    store["area_floor"]["kitchen"] = "first_floor"
    store["area_floor"]["dining"] = "first_floor"

    lm = areas_state.build_label_map(hass, "feature_leader")
    # Both areas on the same floor collapse into one floor-scoped entry.
    keys = [k for k in lm if k.endswith("||House Mode")]
    assert keys == ["first_floor||House Mode"]


def test_area_label_map_ignores_modifier_labels(fake_registry):
    hass = FakeHass()
    store = fake_registry
    store["label_areas"]["feature_leader"] = ["grow"]
    store["area_labels"]["grow"] = [
        "Area Provides: Root Zone",
        "Area Provides Root Zone Min: 0",
        "Area Provides Root Zone Max: 2000",
    ]
    lm = areas_state.build_label_map(hass, "feature_leader")
    # Only the real feature registers; Min/Max modifiers are filtered.
    assert list(lm.keys()) == ["grow||Root Zone"]
