"""The Labeled Features integration.

Phase 1 replaces the two legacy trigger-based template sensors with native
Python entities:

    * ``sensor.<slug>_state``        — the leaders/features/snapshots engine
    * ``sensor.<slug>_areas_state``  — the label_map (area-based feature) engine

Configuration is UI-driven (config flow / options flow) but defaults to the
existing label-driven behaviour so labels keep working with zero config.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_FEATURE_META,
    DEFAULT_FEATURE_META,
    DOMAIN,
    PLATFORMS,
)

_LOGGER = logging.getLogger(__name__)

type LabeledFeaturesConfigEntry = ConfigEntry


def resolve_feature_meta(options: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Merge the built-in feature_meta catalog with any JSON override.

    A user-supplied JSON object is merged *over* the defaults (per-key), so a
    user can add new domain groupings or tweak an entry without redeclaring
    the whole catalog.
    """
    meta = {k: dict(v) for k, v in DEFAULT_FEATURE_META.items()}
    raw = (options.get(CONF_FEATURE_META) or "").strip()
    if not raw:
        return meta
    try:
        override = json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        _LOGGER.warning("Invalid feature_meta JSON override; using defaults only")
        return meta
    if isinstance(override, dict):
        for name, entry in override.items():
            if isinstance(entry, dict):
                meta[name] = {**meta.get(name, {}), **entry}
    return meta


async def async_setup_entry(
    hass: HomeAssistant, entry: LabeledFeaturesConfigEntry
) -> bool:
    """Set up Labeled Features from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: LabeledFeaturesConfigEntry
) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_update_listener(
    hass: HomeAssistant, entry: LabeledFeaturesConfigEntry
) -> None:
    """Reload the entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)
