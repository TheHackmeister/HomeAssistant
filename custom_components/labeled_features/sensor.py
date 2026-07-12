"""Sensor platform for the Labeled Features integration.

Two native sensor entities that replace the legacy trigger-based template
sensors:

    * LabeledFeaturesStateSensor  — leaders/features/snapshots engine
    * LabeledFeatureAreasStateSensor — label_map engine

Both keep the exact attribute schemas the existing automations/scripts
consume, and derive their object_ids from the configured engine name so the
default engine name reproduces the legacy entity_ids verbatim.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.restore_state import RestoreEntity

from . import resolve_feature_meta
from .areas_state import build_label_map, count_gated_areas
from .const import (
    CONF_AREAS_OBJECT_ID,
    CONF_DEFAULT_COMPONENT,
    CONF_DEFAULT_ERROR_MODE,
    CONF_ALERT_SCRIPT,
    CONF_ENGINE_NAME,
    CONF_GATE_LABEL,
    CONF_SET_EVENT,
    CONF_SNAPSHOT_EVENT,
    CONF_STATE_OBJECT_ID,
    DEFAULT_ALERT_SCRIPT,
    DEFAULT_AREAS_OBJECT_ID,
    DEFAULT_COMPONENT,
    DEFAULT_ENGINE_NAME,
    DEFAULT_ERROR_MODE,
    DEFAULT_GATE_LABEL,
    DEFAULT_SET_EVENT,
    DEFAULT_SNAPSHOT_EVENT,
    DEFAULT_STATE_OBJECT_ID,
    DOMAIN,
)
from .error_handling import LabeledFeatureStop, async_handle_error
from .features_state import FeaturesEngine, FeaturesSnapshot
from . import labels as reg

_LOGGER = logging.getLogger(__name__)

EVENT_HA_START = "homeassistant_start"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the two Labeled Features sensors from a config entry."""
    options = entry.options or {}
    engine_name = options.get(CONF_ENGINE_NAME, DEFAULT_ENGINE_NAME)
    gate_label = options.get(CONF_GATE_LABEL, DEFAULT_GATE_LABEL)
    default_component = options.get(CONF_DEFAULT_COMPONENT, DEFAULT_COMPONENT)
    error_mode = options.get(CONF_DEFAULT_ERROR_MODE, DEFAULT_ERROR_MODE)
    alert_script = options.get(CONF_ALERT_SCRIPT, DEFAULT_ALERT_SCRIPT)
    set_event = options.get(CONF_SET_EVENT, DEFAULT_SET_EVENT)
    snapshot_event = options.get(CONF_SNAPSHOT_EVENT, DEFAULT_SNAPSHOT_EVENT)
    state_object_id = options.get(CONF_STATE_OBJECT_ID, DEFAULT_STATE_OBJECT_ID)
    areas_object_id = options.get(CONF_AREAS_OBJECT_ID, DEFAULT_AREAS_OBJECT_ID)
    feature_meta = resolve_feature_meta(options)

    state_sensor = LabeledFeaturesStateSensor(
        entry=entry,
        engine_name=engine_name,
        gate_label=gate_label,
        object_id=state_object_id,
        set_event=set_event,
        snapshot_event=snapshot_event,
        error_mode=error_mode,
        alert_script=alert_script,
        feature_meta=feature_meta,
    )
    areas_sensor = LabeledFeatureAreasStateSensor(
        entry=entry,
        engine_name=engine_name,
        gate_label=gate_label,
        object_id=areas_object_id,
        default_component=default_component,
        error_mode=error_mode,
        alert_script=alert_script,
    )

    async_add_entities([state_sensor, areas_sensor])


class _BaseLabeledSensor(RestoreEntity, SensorEntity):
    """Shared plumbing for both sensors."""

    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        *,
        entry: ConfigEntry,
        engine_name: str,
        gate_label: str,
        object_id: str,
        role: str,
        error_mode: str,
        alert_script: str,
    ) -> None:
        self._entry = entry
        self._engine_name = engine_name
        self._gate_label = gate_label
        self._error_mode = error_mode
        self._alert_script = alert_script
        self._role = role
        # Pin the object_id so it reproduces the legacy entity_id.
        self.entity_id = f"sensor.{object_id}"
        self._attr_unique_id = f"{entry.entry_id}_{role}"

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": self._engine_name,
            "manufacturer": "Labeled Features",
            "entry_type": "service",
        }

    async def _report_error(self, message: str, severity: str = "medium") -> None:
        try:
            await async_handle_error(
                self.hass,
                error_mode=self._error_mode,
                source=self._engine_name,
                message=message,
                severity=severity,
                alert_script=self._alert_script,
            )
        except LabeledFeatureStop:
            # `stop` tier: abort this evaluation but keep the entity alive.
            _LOGGER.debug("%s: evaluation stopped by error mode", self._engine_name)


class LabeledFeaturesStateSensor(_BaseLabeledSensor):
    """``sensor.<slug>_state`` — leaders/features/snapshots engine."""

    _attr_native_unit_of_measurement = "leaders"

    def __init__(
        self,
        *,
        entry: ConfigEntry,
        engine_name: str,
        gate_label: str,
        object_id: str,
        set_event: str,
        snapshot_event: str,
        error_mode: str,
        alert_script: str,
        feature_meta: dict[str, Any],
    ) -> None:
        super().__init__(
            entry=entry,
            engine_name=engine_name,
            gate_label=gate_label,
            object_id=object_id,
            role="state",
            error_mode=error_mode,
            alert_script=alert_script,
        )
        self._attr_name = engine_name
        self._set_event = set_event
        self._snapshot_event = snapshot_event
        self._feature_meta = feature_meta
        self._snapshot = FeaturesSnapshot()
        self._engine: FeaturesEngine | None = None
        self._unsub_state: Any = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._engine = FeaturesEngine(self.hass, self._gate_label, self.entity_id)

        # Restore previous attributes (recorder-restored in the YAML version).
        last = await self.async_get_last_extra_data()
        if last is not None:
            data = last.as_dict()
            self._snapshot = FeaturesSnapshot(
                leaders=data.get("leaders", {}) or {},
                features=data.get("features", {}) or {},
                snapshots=data.get("snapshots", {}) or {},
            )

        self._resubscribe_leaders()

        # Custom events.
        self.async_on_remove(
            self.hass.bus.async_listen(self._set_event, self._handle_manual_set)
        )
        self.async_on_remove(
            self.hass.bus.async_listen(
                self._snapshot_event, self._handle_snapshot_set
            )
        )
        # Re-subscribe on label-registry changes so the leader watch set stays
        # accurate (this fixes the documented stale-orphan trade-off).
        self.async_on_remove(
            self.hass.bus.async_listen(
                "entity_registry_updated", self._handle_registry_update
            )
        )
        self.async_on_remove(
            self.hass.bus.async_listen(
                "label_registry_updated", self._handle_registry_update
            )
        )

    @callback
    def _resubscribe_leaders(self) -> None:
        if self._unsub_state is not None:
            self._unsub_state()
            self._unsub_state = None
        leaders = reg.entities_with_label_name(self.hass, self._gate_label)
        if leaders:
            self._unsub_state = async_track_state_change_event(
                self.hass, leaders, self._handle_leader_change
            )

    @callback
    def _handle_registry_update(self, _event: Event) -> None:
        self._resubscribe_leaders()

    async def _handle_leader_change(self, event: Event) -> None:
        entity_id = event.data.get("entity_id")
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        # Gate: reject events without a real prior state (boot restore, etc).
        if old_state is None or str(old_state.state).lower() in (
            "unknown",
            "unavailable",
            "none",
        ):
            return
        try:
            self._snapshot = self._engine.reduce_state_changed(
                self._snapshot, entity_id, new_state
            )
        except Exception as err:  # noqa: BLE001
            await self._report_error(f"state_changed evaluation failed: {err}")
            return
        self.async_write_ha_state()

    async def _handle_manual_set(self, event: Event) -> None:
        try:
            self._snapshot = self._engine.reduce_manual_set(
                self._snapshot, dict(event.data)
            )
        except Exception as err:  # noqa: BLE001
            await self._report_error(f"manual set failed: {err}")
            return
        self.async_write_ha_state()

    async def _handle_snapshot_set(self, event: Event) -> None:
        try:
            self._snapshot = self._engine.reduce_snapshot_set(
                self._snapshot, dict(event.data)
            )
        except Exception as err:  # noqa: BLE001
            await self._report_error(f"snapshot set failed: {err}")
            return
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        return len(reg.entities_with_label_name(self.hass, self._gate_label))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._snapshot.as_attributes(self._feature_meta)

    @property
    def extra_restore_state_data(self):
        from homeassistant.helpers.restore_state import ExtraStoredData

        snapshot = self._snapshot

        class _Data(ExtraStoredData):
            def as_dict(self) -> dict[str, Any]:
                return {
                    "leaders": snapshot.leaders,
                    "features": snapshot.features,
                    "snapshots": snapshot.snapshots,
                }

        return _Data()


class LabeledFeatureAreasStateSensor(_BaseLabeledSensor):
    """``sensor.<slug>_areas_state`` — label_map engine."""

    _attr_native_unit_of_measurement = "areas"

    def __init__(
        self,
        *,
        entry: ConfigEntry,
        engine_name: str,
        gate_label: str,
        object_id: str,
        default_component: str,
        error_mode: str,
        alert_script: str,
    ) -> None:
        super().__init__(
            entry=entry,
            engine_name=engine_name,
            gate_label=gate_label,
            object_id=object_id,
            role="areas_state",
            error_mode=error_mode,
            alert_script=alert_script,
        )
        self._attr_name = f"{engine_name} Areas"
        self._default_component = default_component
        self._label_map: dict[str, Any] = {}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        for event_type in (
            "label_registry_updated",
            "area_registry_updated",
            "floor_registry_updated",
            "entity_registry_updated",
        ):
            self.async_on_remove(
                self.hass.bus.async_listen(event_type, self._handle_registry_update)
            )
        self.async_on_remove(
            self.hass.bus.async_listen(
                "homeassistant_start", self._handle_registry_update
            )
        )
        await self._rebuild()

    async def _handle_registry_update(self, _event: Event) -> None:
        await self._rebuild()

    async def _rebuild(self) -> None:
        try:
            self._label_map = build_label_map(
                self.hass, self._gate_label, self._default_component
            )
        except Exception as err:  # noqa: BLE001
            await self._report_error(f"label_map build failed: {err}")
            return
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        return count_gated_areas(self.hass, self._gate_label)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"label_map": self._label_map}
