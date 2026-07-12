"""Registry / label helper utilities for the Labeled Features integration.

Thin wrappers over HA's label / entity / area / floor registries that mirror
the Jinja template functions the legacy config used
(``label_entities``, ``label_areas``, ``labels``, ``floors``, ``floor_areas``,
``area_id``). Keeping these in one place makes the sensor logic read close to
the documented templates.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    entity_registry as er,
    floor_registry as fr,
    label_registry as lr,
)


def label_id_for_name(hass: HomeAssistant, name: str) -> str | None:
    """Return the label_id whose name matches ``name`` (exact, case-sensitive)."""
    reg = lr.async_get(hass)
    for label in reg.async_list_labels():
        if label.name == name:
            return label.label_id
    return None


def entity_label_names(hass: HomeAssistant, entity_id: str) -> list[str]:
    """Return the label *names* applied to an entity (case-sensitive)."""
    ent_reg = er.async_get(hass)
    lab_reg = lr.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None:
        return []
    names: list[str] = []
    for label_id in entry.labels:
        label = lab_reg.async_get_label(label_id)
        if label is not None:
            names.append(label.name)
    return names


def area_label_names(hass: HomeAssistant, area_id: str) -> list[str]:
    """Return the label *names* applied to an area (case-sensitive)."""
    area_reg = ar.async_get(hass)
    lab_reg = lr.async_get(hass)
    entry = area_reg.async_get_area(area_id)
    if entry is None:
        return []
    names: list[str] = []
    for label_id in entry.labels:
        label = lab_reg.async_get_label(label_id)
        if label is not None:
            names.append(label.name)
    return names


def entities_with_label_name(hass: HomeAssistant, label_name: str) -> list[str]:
    """Return entity_ids carrying a label by name (``label_entities`` equiv)."""
    label_id = label_id_for_name(hass, label_name)
    if label_id is None:
        return []
    ent_reg = er.async_get(hass)
    return [
        entry.entity_id
        for entry in ent_reg.entities.values()
        if label_id in entry.labels
    ]


def areas_with_label_name(hass: HomeAssistant, label_name: str) -> list[str]:
    """Return area_ids carrying a label by name (``label_areas`` equiv)."""
    label_id = label_id_for_name(hass, label_name)
    if label_id is None:
        return []
    area_reg = ar.async_get(hass)
    return [
        area.id
        for area in area_reg.async_list_areas()
        if label_id in area.labels
    ]


def entity_area_id(hass: HomeAssistant, entity_id: str) -> str | None:
    """Resolve an entity's effective area_id (entity override → device area)."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None:
        return None
    if entry.area_id:
        return entry.area_id
    if entry.device_id:
        from homeassistant.helpers import device_registry as dr

        dev_reg = dr.async_get(hass)
        device = dev_reg.async_get(entry.device_id)
        if device is not None:
            return device.area_id
    return None


def floor_of_area(hass: HomeAssistant, area_id: str) -> str | None:
    """Return the floor_id containing ``area_id`` (or None)."""
    area_reg = ar.async_get(hass)
    entry = area_reg.async_get_area(area_id)
    if entry is None:
        return None
    return entry.floor_id


def floor_ids(hass: HomeAssistant) -> list[str]:
    """Return all floor_ids (``floors`` equiv)."""
    return [floor.floor_id for floor in fr.async_get(hass).async_list_floors()]
