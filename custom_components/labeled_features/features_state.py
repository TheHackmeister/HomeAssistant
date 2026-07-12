"""Leaders / features / snapshots engine.

Python port of the ``sensor.labeled_features_state`` trigger-based template
sensor (configuration.yaml). Produces the exact same attribute schema so the
existing ``automation.labeled_feature_leaders``, the sleep-timeout snapshot
round-trip, and Arg substitutions all keep working unchanged.

The engine is a pure(-ish) reducer: it takes the previous attribute snapshot
and a single event (a leader ``state_changed``, a ``labeled_feature_set``
manual override, or a ``labeled_feature_snapshot_set``) and returns the next
snapshot. Registry access (labels/areas/floors) is injected via the ``labels``
helper module so it can be unit-tested with a fake.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from time import time as _now_ts
from typing import Any

from homeassistant.core import HomeAssistant, State

from . import labels as reg
from .const import ALWAYS_TRUE_DOMAINS, TRUTHY_STATES, UNREAL_STATES

_LEADER_RE = re.compile(r"^(Area |Floor |)Leader: (.+)$")
_INITIAL_PRESS_RE = re.compile(r"_initial_press$")


def _is_unreal(value: Any) -> bool:
    return str(value).strip().lower() in UNREAL_STATES


def _leader_value(state: State | None) -> str:
    """Extract the comparison value for a leader state.

    Event entities compare on their ``event_type`` attribute; everything else
    compares on plain state.
    """
    if state is None:
        return ""
    if state.entity_id.split(".")[0] == "event":
        return str(state.attributes.get("event_type") or state.state)
    return state.state


@dataclass
class FeaturesSnapshot:
    """The full attribute payload emitted by the features-state sensor."""

    leaders: dict[str, dict[str, Any]] = field(default_factory=dict)
    features: dict[str, Any] = field(default_factory=dict)
    snapshots: dict[str, Any] = field(default_factory=dict)

    def as_attributes(self, feature_meta: dict[str, Any]) -> dict[str, Any]:
        return {
            "feature_meta": feature_meta,
            "leaders": self.leaders,
            "features": self.features,
            "snapshots": self.snapshots,
        }


class FeaturesEngine:
    """Reducer that maintains the leaders/features/snapshots attributes."""

    def __init__(
        self,
        hass: HomeAssistant,
        gate_label: str,
        state_entity_id: str,
    ) -> None:
        self._hass = hass
        self._gate_label = gate_label
        # entity_id of the sensor itself — its labels carry the per-triple
        # `<Scoped F> Mode: Leader|Any|All` configuration.
        self._state_entity_id = state_entity_id

    # ── registry helpers ────────────────────────────────────────────────
    def _leader_entities(self) -> list[str]:
        return reg.entities_with_label_name(self._hass, self._gate_label)

    def _entity_labels(self, entity_id: str) -> list[str]:
        return reg.entity_label_names(self._hass, entity_id)

    def _sensor_labels(self) -> list[str]:
        return reg.entity_label_names(self._hass, self._state_entity_id)

    def _scope_of_leader(self, entity_id: str) -> tuple[str | None, str | None]:
        """Return (area_id, floor_id) for a leader entity."""
        area_id = reg.entity_area_id(self._hass, entity_id)
        floor_id = reg.floor_of_area(self._hass, area_id) if area_id else None
        return area_id, floor_id

    # ── truth function (mirrors the eval_leader macro) ──────────────────
    def _eval_leader(
        self,
        entity_id: str,
        scope_pfx: str,
        fname: str,
        current_value: Any,
        previous_value: Any,
    ) -> bool:
        lbls = self._entity_labels(entity_id)
        state = self._hass.states.get(entity_id)
        st = state.state if state is not None else ""
        dom = entity_id.split(".")[0]

        inc_lbl = f"{scope_pfx}{fname} Increasing: True" in lbls
        dec_lbl = f"{scope_pfx}{fname} Decreasing: True" in lbls

        if inc_lbl or dec_lbl:
            cur_n = _to_float(current_value)
            prev_n = _to_float(previous_value)
            has_mov = cur_n is not None and prev_n is not None
            is_inc = has_mov and cur_n > prev_n
            is_dec = has_mov and cur_n < prev_n
            base = (inc_lbl and is_inc) or (dec_lbl and is_dec)
        else:
            en_val = _label_value(lbls, f"{scope_pfx}{fname} Enable: ")
            dis_val = _label_value(lbls, f"{scope_pfx}{fname} Disable: ")
            if en_val != "" or dis_val != "":
                by_en = en_val != "" and st == en_val
                by_dis = dis_val != "" and st == dis_val
                if en_val != "" and dis_val != "":
                    base = by_en and not by_dis
                elif en_val != "":
                    base = by_en
                else:
                    base = not by_dis
            elif dom in ALWAYS_TRUE_DOMAINS:
                base = True
            else:
                base = (st == fname) or (str(st).lower() in TRUTHY_STATES)

        inverted = f"{scope_pfx}{fname} Invert: True" in lbls
        return (not base) if inverted else base

    # ── triple map (feature, scope, scope_id) → [leader entity_ids] ─────
    def _build_triples(self, leaders: list[str]) -> dict[str, list[str]]:
        triples: dict[str, list[str]] = {}
        for eid in leaders:
            area_id, floor_id = self._scope_of_leader(eid)
            for lbl in self._entity_labels(eid):
                m = _LEADER_RE.match(lbl)
                if not m:
                    continue
                prefix = m.group(1).strip()
                fname = m.group(2).strip()
                if prefix == "Area":
                    scope_val, scope_id_val = "area", area_id
                elif prefix == "Floor":
                    scope_val, scope_id_val = "floor", floor_id
                else:
                    scope_val, scope_id_val = "global", ""
                if scope_val in ("area", "floor") and not scope_id_val:
                    # cannot resolve scope — skip
                    continue
                key = f"{fname}||{scope_val}||{scope_id_val}"
                triples.setdefault(key, [])
                if eid not in triples[key]:
                    triples[key].append(eid)
        return triples

    def _modes_for(self, triples: dict[str, list[str]]) -> dict[str, str]:
        sensor_labels = self._sensor_labels()
        modes: dict[str, str] = {}
        for key in triples:
            fname, scope_val, _sid = key.split("||")
            scope_pfx = (
                "Area " if scope_val == "area" else "Floor " if scope_val == "floor" else ""
            )
            pattern = re.compile(
                rf"^{re.escape(scope_pfx + fname)} Mode: (Leader|Any|All)$"
            )
            mode = "leader"
            for lbl in sensor_labels:
                mm = pattern.match(lbl)
                if mm:
                    mode = mm.group(1).lower()
                    break
            modes[key] = mode
        return modes

    # ── reducers ────────────────────────────────────────────────────────
    def reduce_state_changed(
        self,
        prev: FeaturesSnapshot,
        entity_id: str,
        new_state: State | None,
    ) -> FeaturesSnapshot:
        """Handle a leader ``state_changed`` event."""
        leaders_now = self._leader_entities()
        if entity_id not in leaders_now:
            # Not (or no longer) a leader — nothing to do beyond orphan drop,
            # which happens on the next leader-driven tick like the YAML.
            return prev

        new_leaders = self._rebuild_leaders(
            prev.leaders, leaders_now, entity_id, new_state
        )

        triples = self._build_triples(leaders_now)
        modes = self._modes_for(triples)
        new_features = self._carry_and_reevaluate(
            prev.features, triples, modes, entity_id, new_state, prev.leaders
        )

        return FeaturesSnapshot(
            leaders=new_leaders, features=new_features, snapshots=prev.snapshots
        )

    def reduce_manual_set(
        self, prev: FeaturesSnapshot, data: dict[str, Any]
    ) -> FeaturesSnapshot:
        """Handle a ``labeled_feature_set`` manual override event."""
        leaders_now = self._leader_entities()
        triples = self._build_triples(leaders_now)
        features = self._carry_features(prev.features, triples)

        tgt = str(data.get("target_feature") or "").strip()
        scp = str(data.get("scope") or "").strip().lower()
        sid = str(data.get("scope_id") or "")
        ena = _to_bool(data.get("enabled"), default=False)
        ts = _to_float(data.get("timestamp"))
        if ts is None:
            ts = _now_ts()

        if tgt != "" and scp in ("area", "floor", "global"):
            prev_entry = features.get(tgt, {}).get(scp, {}).get(sid, {})
            mode = prev_entry.get("mode", "leader")
            features.setdefault(tgt, {}).setdefault(scp, {})[sid] = {
                "enabled": ena,
                "mode": mode,
                "last_changed_timestamp": ts,
                "triggering_leader": "",
            }

        return FeaturesSnapshot(
            leaders=prev.leaders, features=features, snapshots=prev.snapshots
        )

    def reduce_snapshot_set(
        self, prev: FeaturesSnapshot, data: dict[str, Any]
    ) -> FeaturesSnapshot:
        """Handle a ``labeled_feature_snapshot_set`` event."""
        sname = str(data.get("snapshot_name") or "").strip()
        payload = data.get("payload")
        out = {k: v for k, v in prev.snapshots.items() if k != sname}
        if sname != "" and isinstance(payload, dict) and len(payload) > 0:
            out[sname] = payload
        elif sname == "":
            out = dict(prev.snapshots)
        return FeaturesSnapshot(
            leaders=prev.leaders, features=prev.features, snapshots=out
        )

    # ── internals ────────────────────────────────────────────────────────
    def _rebuild_leaders(
        self,
        prev_leaders: dict[str, dict[str, Any]],
        leaders_now: list[str],
        changed_eid: str,
        new_state: State | None,
    ) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        # Carry through existing entries for entities still labeled.
        for eid, ldat in prev_leaders.items():
            if eid in leaders_now and eid != changed_eid:
                result[eid] = ldat
        # Seed any newly-labeled leaders.
        for eid in leaders_now:
            if eid not in result and eid != changed_eid:
                st = self._hass.states.get(eid)
                result[eid] = {
                    "current_value": st.state if st is not None else "",
                    "previous_value": "",
                    "last_changed_timestamp": (
                        st.last_changed.timestamp() if st is not None else 0
                    ),
                }
        # Rebuild the changed leader's entry.
        cv_raw = _leader_value(new_state)
        is_skip = bool(_INITIAL_PRESS_RE.search(cv_raw)) or _is_unreal(cv_raw)
        prev_l = prev_leaders.get(changed_eid, {})
        ts = (
            new_state.last_changed.timestamp()
            if (new_state is not None and new_state.last_changed is not None)
            else _now_ts()
        )
        if is_skip:
            cv = prev_l.get("current_value", cv_raw)
            cv_ts = prev_l.get("last_changed_timestamp", ts)
        else:
            cv = cv_raw
            cv_ts = ts
        old_cv = prev_l.get("current_value", "")
        old_pv = prev_l.get("previous_value", "")
        prev_cv_raw = old_cv if cv != old_cv else old_pv
        prev_cv = (
            ""
            if (_INITIAL_PRESS_RE.search(str(prev_cv_raw)) or _is_unreal(prev_cv_raw))
            else prev_cv_raw
        )
        result[changed_eid] = {
            "current_value": cv,
            "previous_value": prev_cv,
            "last_changed_timestamp": cv_ts,
        }
        return result

    def _carry_features(
        self, prev_features: dict[str, Any], triples: dict[str, list[str]]
    ) -> dict[str, Any]:
        """Carry through triples that still have a leader or are manual."""
        result: dict[str, Any] = {}
        for fname, scopes_map in _as_map(prev_features).items():
            for scope_val, sids in _as_map(scopes_map).items():
                for scope_id_val, entry in _as_map(sids).items():
                    _entry = entry if isinstance(entry, dict) else {}
                    key = f"{fname}||{scope_val}||{scope_id_val}"
                    has_leader = key in triples
                    is_manual = _entry.get("triggering_leader", "") == ""
                    if has_leader or is_manual:
                        result.setdefault(fname, {}).setdefault(scope_val, {})[
                            scope_id_val
                        ] = _entry
        return result

    def _carry_and_reevaluate(
        self,
        prev_features: dict[str, Any],
        triples: dict[str, list[str]],
        modes: dict[str, str],
        changed_eid: str,
        new_state: State | None,
        prev_leaders: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        result = self._carry_features(prev_features, triples)

        cv_raw = _leader_value(new_state)
        is_skip = bool(_INITIAL_PRESS_RE.search(cv_raw)) or _is_unreal(cv_raw)
        if is_skip:
            return result

        ts = (
            new_state.last_changed.timestamp()
            if (new_state is not None and new_state.last_changed is not None)
            else _now_ts()
        )
        prev_cv = prev_leaders.get(changed_eid, {}).get("current_value", "")
        leader_dom = changed_eid.split(".")[0]
        is_button_leader = leader_dom in ALWAYS_TRUE_DOMAINS

        for key, leaders_list in triples.items():
            if changed_eid not in leaders_list:
                continue
            fname, scope_val, scope_id_val = key.split("||")
            scope_pfx = (
                "Area " if scope_val == "area" else "Floor " if scope_val == "floor" else ""
            )
            mode = modes.get(key, "leader")
            this_truth = self._eval_leader(
                changed_eid, scope_pfx, fname, cv_raw, prev_cv
            )

            if mode == "leader":
                new_enabled = this_truth
            else:
                values: list[bool] = []
                for other_eid in leaders_list:
                    if other_eid == changed_eid:
                        values.append(this_truth)
                    else:
                        other_state = self._hass.states.get(other_eid)
                        other_cv = other_state.state if other_state is not None else ""
                        other_prev = prev_leaders.get(other_eid, {}).get(
                            "previous_value", ""
                        )
                        values.append(
                            self._eval_leader(
                                other_eid, scope_pfx, fname, other_cv, other_prev
                            )
                        )
                new_enabled = all(values) if mode == "all" else any(values)

            prev_entry = (
                result.get(fname, {}).get(scope_val, {}).get(scope_id_val, {})
            )
            prev_enabled = prev_entry.get("enabled", None)
            prev_ts = prev_entry.get("last_changed_timestamp", ts)
            flipped = (
                prev_enabled is None
                or prev_enabled != new_enabled
                or is_button_leader
            )
            new_ts = ts if flipped else prev_ts

            result.setdefault(fname, {}).setdefault(scope_val, {})[scope_id_val] = {
                "enabled": new_enabled,
                "mode": mode,
                "last_changed_timestamp": new_ts,
                "triggering_leader": changed_eid,
            }
        return result


# ── small helpers ────────────────────────────────────────────────────────
def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ("true", "1", "yes", "on")


def _label_value(labels: list[str], prefix: str) -> str:
    """Return the value part of the first label matching ``<prefix><value>``."""
    for lbl in labels:
        if lbl.startswith(prefix):
            return lbl[len(prefix):]
    return ""


def _as_map(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}
