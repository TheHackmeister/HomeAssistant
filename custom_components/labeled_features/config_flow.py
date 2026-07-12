"""Config & options flow for the Labeled Features integration."""

from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.util import slugify

from .const import (
    CONF_ALERT_SCRIPT,
    CONF_AREAS_OBJECT_ID,
    CONF_DEFAULT_COMPONENT,
    CONF_DEFAULT_ERROR_MODE,
    CONF_ENGINE_NAME,
    CONF_FEATURE_META,
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
    ERROR_MODES,
)


def _derive_object_ids(engine_name: str) -> tuple[str, str]:
    """Derive the two sensor object_ids from an engine name.

    The default engine name ("Labeled Features") maps onto the legacy
    object_ids exactly so existing automations/scripts keep working:
        sensor.labeled_features_state
        sensor.labeled_feature_areas_state
    For any other engine name we slugify and append ``_state`` /
    ``_areas_state``.
    """
    slug = slugify(engine_name)
    if slug == slugify(DEFAULT_ENGINE_NAME):
        return DEFAULT_STATE_OBJECT_ID, DEFAULT_AREAS_OBJECT_ID
    return f"{slug}_state", f"{slug}_areas_state"


def _base_schema(defaults: dict[str, Any]) -> vol.Schema:
    """Schema shared between the user step and the options flow."""
    return vol.Schema(
        {
            vol.Required(
                CONF_ENGINE_NAME,
                default=defaults.get(CONF_ENGINE_NAME, DEFAULT_ENGINE_NAME),
            ): str,
            vol.Required(
                CONF_GATE_LABEL,
                default=defaults.get(CONF_GATE_LABEL, DEFAULT_GATE_LABEL),
            ): str,
            vol.Optional(
                CONF_STATE_OBJECT_ID,
                description={
                    "suggested_value": defaults.get(CONF_STATE_OBJECT_ID, "")
                },
            ): str,
            vol.Optional(
                CONF_AREAS_OBJECT_ID,
                description={
                    "suggested_value": defaults.get(CONF_AREAS_OBJECT_ID, "")
                },
            ): str,
            vol.Required(
                CONF_DEFAULT_COMPONENT,
                default=defaults.get(CONF_DEFAULT_COMPONENT, DEFAULT_COMPONENT),
            ): str,
            vol.Required(
                CONF_DEFAULT_ERROR_MODE,
                default=defaults.get(CONF_DEFAULT_ERROR_MODE, DEFAULT_ERROR_MODE),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=ERROR_MODES,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(
                CONF_ALERT_SCRIPT,
                default=defaults.get(CONF_ALERT_SCRIPT, DEFAULT_ALERT_SCRIPT),
            ): str,
            vol.Required(
                CONF_SET_EVENT,
                default=defaults.get(CONF_SET_EVENT, DEFAULT_SET_EVENT),
            ): str,
            vol.Required(
                CONF_SNAPSHOT_EVENT,
                default=defaults.get(CONF_SNAPSHOT_EVENT, DEFAULT_SNAPSHOT_EVENT),
            ): str,
            vol.Optional(
                CONF_FEATURE_META,
                description={
                    "suggested_value": defaults.get(CONF_FEATURE_META, "")
                },
            ): str,
        }
    )


def _validate_and_fill(user_input: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Validate user input; fill derived object_ids; return (data, errors)."""
    errors: dict[str, str] = {}
    data = dict(user_input)

    engine_name = (data.get(CONF_ENGINE_NAME) or "").strip()
    if not engine_name:
        errors[CONF_ENGINE_NAME] = "required"
        engine_name = DEFAULT_ENGINE_NAME
    data[CONF_ENGINE_NAME] = engine_name

    derived_state, derived_areas = _derive_object_ids(engine_name)
    if not (data.get(CONF_STATE_OBJECT_ID) or "").strip():
        data[CONF_STATE_OBJECT_ID] = derived_state
    if not (data.get(CONF_AREAS_OBJECT_ID) or "").strip():
        data[CONF_AREAS_OBJECT_ID] = derived_areas

    # Validate optional feature_meta JSON override.
    raw_meta = (data.get(CONF_FEATURE_META) or "").strip()
    if raw_meta:
        try:
            parsed = json.loads(raw_meta)
            if not isinstance(parsed, dict):
                raise ValueError("feature_meta must be a JSON object")
        except (ValueError, json.JSONDecodeError):
            errors[CONF_FEATURE_META] = "invalid_json"
    return data, errors


class LabeledFeaturesConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial UI setup."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First (and only) setup step."""
        errors: dict[str, str] = {}
        if user_input is not None:
            data, errors = _validate_and_fill(user_input)
            if not errors:
                await self.async_set_unique_id(slugify(data[CONF_ENGINE_NAME]))
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=data[CONF_ENGINE_NAME],
                    data={},
                    options=data,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_base_schema(user_input or {}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow handler."""
        return LabeledFeaturesOptionsFlow()


class LabeledFeaturesOptionsFlow(OptionsFlow):
    """Handle post-setup option changes."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Edit the engine's options."""
        errors: dict[str, str] = {}
        if user_input is not None:
            data, errors = _validate_and_fill(user_input)
            if not errors:
                return self.async_create_entry(title="", data=data)

        return self.async_show_form(
            step_id="init",
            data_schema=_base_schema(user_input or dict(self.config_entry.options)),
            errors=errors,
        )
