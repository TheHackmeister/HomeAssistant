"""Areas engine (``label_map``).

Python port of the ``sensor.labeled_feature_areas_state`` trigger-based
template sensor (configuration.yaml). Produces the flat ``label_map`` attribute
the ``automation.labeled_feature_areas`` diffs directly, with the identical
``<scope_id>||<label>`` → ``{scope_id, label, scope, component,
declaring_area_id, label_data}`` schema.

The sensor's single job is a lightweight trigger surface: it re-renders when
the label / area / floor registries change and emits the flat registry. It
does NOT compute object_ids and does NOT know about specific features —
``script.labeled_feature_area`` owns canonical naming. The only override the
sensor honors is a ``(Area |Floor |)Provides <Label> Component: <comp>``
modifier label on the declaring area (default ``select``).
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant

from . import labels as reg

_PROVIDES_RE = re.compile(r"^(Area |Floor |)Provides: (.+)$")
# Modifier labels that should NOT register as features in their own right.
_MODIFIER_RE = re.compile(
    r"^[^:]+ (Component|Min|Max|Step|Unit|Icon|Initial|Static|Mode|Device Class): "
)


def build_label_map(
    hass: HomeAssistant, gate_label: str, default_component: str = "select"
) -> dict[str, dict[str, Any]]:
    """Build the flat ``<scope_id>||<label>`` → label_data map.

    Mirrors the two-pass template: Pass 1 captures floor_id per gated area,
    Pass 2 parses each area's ``(Area |Floor |)Provides:`` labels, resolves the
    scope + scope_id + component-hint, and dedupes by (scope_id, label).
    """
    gated_areas = reg.areas_with_label_name(hass, gate_label)

    # Pass 1 — floor_id per gated area.
    area_floor: dict[str, str] = {}
    for aid in gated_areas:
        area_floor[aid] = reg.floor_of_area(hass, aid) or ""

    # scope_id → {label → label_data}
    scopes: dict[str, dict[str, dict[str, Any]]] = {}

    # Pass 2 — parse Provides labels.
    for aid in gated_areas:
        this_floor_id = area_floor.get(aid, "")
        area_lbls = reg.area_label_names(hass, aid)
        for lbl in area_lbls:
            m = _PROVIDES_RE.match(lbl)
            if not m:
                continue
            prefix = m.group(1).strip()
            lname = m.group(2).strip()
            if lname == "" or _MODIFIER_RE.match(lname):
                continue

            if prefix == "Area":
                scope_val, scope_id_val = "area", aid
            elif prefix == "Floor":
                scope_val, scope_id_val = "floor", this_floor_id
            else:
                scope_val, scope_id_val = "none", aid

            if scope_id_val == "":
                continue

            scope_prefix = (
                "Area " if scope_val == "area" else "Floor " if scope_val == "floor" else ""
            )
            comp_override = _find_component_override(area_lbls, scope_prefix, lname)
            component = comp_override if comp_override != "" else default_component

            label_data = {
                "scope": scope_val,
                "scope_id": scope_id_val,
                "component": component,
                "declaring_area_id": aid,
            }
            scopes.setdefault(scope_id_val, {})
            # Dedupe: first declaration wins per (scope_id, label).
            scopes[scope_id_val].setdefault(lname, label_data)

    # Flatten into the public <scope_id>||<label> → entry map.
    out: dict[str, dict[str, Any]] = {}
    for sid, lmap in scopes.items():
        for lname, ldat in lmap.items():
            out[f"{sid}||{lname}"] = {
                "scope_id": sid,
                "label": lname,
                "scope": ldat.get("scope", "area"),
                "component": ldat.get("component"),
                "declaring_area_id": ldat.get("declaring_area_id"),
                "label_data": ldat,
            }
    return out


def _find_component_override(
    area_labels: list[str], scope_prefix: str, lname: str
) -> str:
    """Return the value of the matching ``Provides <F> Component:`` label."""
    pattern = re.compile(
        rf"^{re.escape(scope_prefix + 'Provides ' + lname + ' Component: ')}(.+)$"
    )
    for lbl in area_labels:
        mm = pattern.match(lbl)
        if mm:
            return mm.group(1).strip()
    return ""


def count_gated_areas(hass: HomeAssistant, gate_label: str) -> int:
    """State value: number of areas carrying the gate label."""
    return len(reg.areas_with_label_name(hass, gate_label))
