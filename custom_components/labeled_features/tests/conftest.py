"""Test configuration.

Makes ``custom_components.labeled_features`` importable by putting the
``HomeAssistant`` config directory (two levels up from this file) on the path,
and installs a very small ``homeassistant`` stub if the real package isn't
available — enough for the pure-logic engine/error-handling unit tests to run
standalone. When the real ``homeassistant`` is installed it is used instead.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

# custom_components/labeled_features/tests/conftest.py → HomeAssistant/
_HA_CONFIG_DIR = Path(__file__).resolve().parents[3]
if str(_HA_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_HA_CONFIG_DIR))


def _install_homeassistant_stub() -> None:
    """Install a minimal ``homeassistant`` stub for standalone unit tests."""
    try:
        import homeassistant  # noqa: F401

        return
    except ImportError:
        pass

    ha = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    config_entries = types.ModuleType("homeassistant.config_entries")
    components = types.ModuleType("homeassistant.components")
    components_sensor = types.ModuleType("homeassistant.components.sensor")

    class HomeAssistant:  # minimal placeholder
        pass

    class State:  # minimal placeholder
        def __init__(self, entity_id, state, attributes=None, last_changed=None):
            self.entity_id = entity_id
            self.state = state
            self.attributes = attributes or {}
            self.last_changed = last_changed

    class Event:  # minimal placeholder
        def __init__(self, event_type, data=None):
            self.event_type = event_type
            self.data = data or {}

    def callback(func):  # decorator no-op
        return func

    core.HomeAssistant = HomeAssistant
    core.State = State
    core.Event = Event
    core.callback = callback

    class ConfigEntry:  # minimal placeholder
        pass

    class ConfigFlow:  # minimal placeholder
        def __init_subclass__(cls, **kwargs):
            return super().__init_subclass__()

    class ConfigFlowResult(dict):
        pass

    class OptionsFlow:
        pass

    config_entries.ConfigEntry = ConfigEntry
    config_entries.ConfigFlow = ConfigFlow
    config_entries.ConfigFlowResult = ConfigFlowResult
    config_entries.OptionsFlow = OptionsFlow

    class SensorEntity:
        pass

    class SensorStateClass:
        MEASUREMENT = "measurement"

    components_sensor.SensorEntity = SensorEntity
    components_sensor.SensorStateClass = SensorStateClass

    helpers = types.ModuleType("homeassistant.helpers")
    for name in (
        "area_registry",
        "entity_registry",
        "floor_registry",
        "label_registry",
        "device_registry",
    ):
        mod = types.ModuleType(f"homeassistant.helpers.{name}")
        mod.async_get = lambda hass: None  # noqa: E731
        setattr(helpers, name, mod)
        sys.modules[f"homeassistant.helpers.{name}"] = mod

    helpers_selector = types.ModuleType("homeassistant.helpers.selector")

    class _Sel:
        def __init__(self, *a, **kw):
            pass

    helpers_selector.SelectSelector = _Sel
    helpers_selector.SelectSelectorConfig = _Sel

    class _Mode:
        DROPDOWN = "dropdown"

    helpers_selector.SelectSelectorMode = _Mode
    sys.modules["homeassistant.helpers.selector"] = helpers_selector

    helpers_ep = types.ModuleType("homeassistant.helpers.entity_platform")
    helpers_ep.AddEntitiesCallback = object
    sys.modules["homeassistant.helpers.entity_platform"] = helpers_ep

    helpers_event = types.ModuleType("homeassistant.helpers.event")
    helpers_event.async_track_state_change_event = lambda *a, **kw: (lambda: None)
    sys.modules["homeassistant.helpers.event"] = helpers_event

    helpers_rs = types.ModuleType("homeassistant.helpers.restore_state")

    class RestoreEntity:
        pass

    class ExtraStoredData:
        pass

    helpers_rs.RestoreEntity = RestoreEntity
    helpers_rs.ExtraStoredData = ExtraStoredData
    sys.modules["homeassistant.helpers.restore_state"] = helpers_rs

    util = types.ModuleType("homeassistant.util")
    util.slugify = lambda s: (
        "_".join(str(s).lower().split()).replace("-", "_")
    )
    sys.modules["homeassistant.util"] = util

    sys.modules["homeassistant"] = ha
    sys.modules["homeassistant.core"] = core
    sys.modules["homeassistant.config_entries"] = config_entries
    sys.modules["homeassistant.helpers"] = helpers
    sys.modules["homeassistant.components"] = components
    sys.modules["homeassistant.components.sensor"] = components_sensor


_install_homeassistant_stub()

# Stub voluptuous if not installed (config_flow imports it at module load).
try:
    import voluptuous  # noqa: F401
except ImportError:
    vol = types.ModuleType("voluptuous")

    class _Marker:
        def __init__(self, key, **kwargs):
            self.key = key

        def __hash__(self):
            return hash(self.key)

        def __eq__(self, other):
            return isinstance(other, _Marker) and self.key == other.key

    vol.Required = _Marker
    vol.Optional = _Marker

    class _Schema(dict):
        def __init__(self, d):
            super().__init__(d)

    vol.Schema = _Schema
    sys.modules["voluptuous"] = vol

