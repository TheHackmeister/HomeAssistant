"""Config flow for the Compesation integration."""
import logging

from typing import Any, Dict
import voluptuous as vol


from . import options_update_listener, take_reading
from .const import (
    CONF_TRACKED_ENTITY_ID,
    CONF_COMPENSATION,
    CONF_DATAPOINTS,
    CONF_DEGREE,
    CONF_POLYNOMIAL,
    CONF_PRECISION,
    DATA_COMPENSATION,
    DEFAULT_CALIBRATED_POSTFIX,
    DEFAULT_DEGREE,
    DEFAULT_NAME,
    DEFAULT_PRECISION,
    DOMAIN,
    FLOW_KEEP_DATA_POINTS,
    MATCH_DATAPOINT,
)

from homeassistant import config_entries
from homeassistant.const import (
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
)
from homeassistant.core import callback
from homeassistant.components.sensor import DOMAIN as DOMAIN_SENSOR
from homeassistant.helpers import config_validation as cv

_LOGGER = logging.getLogger(__name__)


class CompensationConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._errors = {}

    async def async_step_user(self, user_input=None):
        """Step when user initializes a integration."""
        self._errors = {}
        if user_input is not None:
            self.entity_id_from_user_step = user_input[CONF_TRACKED_ENTITY_ID]
            return await self.async_step_configure(user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TRACKED_ENTITY_ID): vol.In(
                        # Note: I considered filtering this to only contain states that were floats, but realized that would exclude some valid attributes we could track on some states.
                        { ent.entity_id: f"{ ent.name } ({ ent.entity_id }) - { ent.state }" for ent in self.hass.states.async_all(DOMAIN_SENSOR) }
                    ),
                }
            ),
            errors=self._errors,
        )

    async def async_step_configure(self, user_input=None):
        """Step when user configures a calibrated sensor."""
        errors = {}

        if user_input and user_input.get(CONF_ENTITY_ID):
            await self.async_set_unique_id( user_input.get(CONF_ENTITY_ID) )
            self._abort_if_unique_id_configured()

            try:
                # Validate the user provided entity_id.
                cv.entity_id(user_input[CONF_ENTITY_ID])
                return self.async_create_entry(
                    title=f"{ self.unique_id }",
                    data={
                        CONF_ENTITY_ID: self.unique_id,
                        CONF_TRACKED_ENTITY_ID: self.entity_id_from_user_step,
                        CONF_NAME: user_input[CONF_NAME],
                        CONF_ATTRIBUTE: user_input.get(CONF_ATTRIBUTE,None),
                        CONF_PRECISION: user_input[CONF_PRECISION],
                        CONF_DEGREE: user_input[CONF_DEGREE],
                        CONF_UNIT_OF_MEASUREMENT: user_input[CONF_UNIT_OF_MEASUREMENT],
                    },
                )
            except vol.Invalid as e:
                errors[CONF_ENTITY_ID] = "entity_id_not_valid"

        tracked_entity_id = self.entity_id_from_user_step
        if tracked_entity_id.endswith("_raw"):
            default_entity_id = tracked_entity_id.replace("_raw", "_calibrated")
            default_name =  self.hass.states.get(tracked_entity_id).name.replace(" Raw", " Calibrated")
        else:
            default_entity_id = f"{ tracked_entity_id }_calibrated"
            default_name = f"{ self.hass.states.get(tracked_entity_id).name } Calibrated"

        return self.async_show_form(
            step_id="configure",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITY_ID, default=default_entity_id): cv.string,
                    vol.Optional(CONF_NAME, default=default_name): cv.string,
                    vol.Optional(CONF_ATTRIBUTE): vol.In( list(self.hass.states.get(tracked_entity_id).attributes.keys()) ),
                    vol.Optional(CONF_PRECISION, default=DEFAULT_PRECISION): cv.positive_int,
                    vol.Optional(CONF_DEGREE, default=DEFAULT_DEGREE): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=1, max=7),
                    ),
                    vol.Optional(CONF_UNIT_OF_MEASUREMENT, default=f"{ self.hass.states.get(tracked_entity_id).attributes.get(CONF_UNIT_OF_MEASUREMENT) }"): cv.string,
                }
            ),
            errors=errors,
        )


    async def async_step_import(self, user_input=None):
        """ Used to import a discovered _raw sensor.
        """
        return await self.async_step_user(user_input)

    @callback
    @staticmethod
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return OptionsFlowHandler(config_entry)


class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handles options flow for the component."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Manage the options."""
        # Will probably use the init flow to pick a subflow eventually.
        # But for now, we only have select_sensors, so that's what gets used.
        return await self.async_step_select_sensors()

    async def async_step_select_sensors(
        self, user_input: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        self._errors = {}

        self._config_entries = { entry.data[CONF_ENTITY_ID]: entry for entry in self.hass.config_entries.async_entries(DOMAIN) }

        if user_input and user_input.get(CONF_ENTITY_ID):
            if not user_input.get(FLOW_KEEP_DATA_POINTS):
                for entity in user_input[CONF_ENTITY_ID]:
                    # Clears the data_points option.
                    entry = self._config_entries.get(entity)
                    self.hass.config_entries.async_update_entry(entry, options={CONF_DATAPOINTS: []})

            self._calibrating_entities = user_input[CONF_ENTITY_ID]

            return await self.async_step_add_calibration_datapoints(user_input)

        return self.async_show_form(
            step_id="select_sensors",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITY_ID): cv.multi_select( { entity_id: entry.data[CONF_NAME] for entity_id, entry in self._config_entries.items() } ),
                    vol.Optional(FLOW_KEEP_DATA_POINTS): vol.Coerce(bool),
                }
            ),
            errors=self._errors,
        )

    async def async_step_add_calibration_datapoints(
        self, user_input: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Manage the options for the custom component."""
        """Step when user configures a calibrated sensor."""
        self._errors = {}

        config_entries = self.hass.config_entries.async_entries(DOMAIN)
        sensor_issues = []

        if user_input and user_input.get(CONF_DATAPOINTS):
            take_reading(self.hass, user_input[CONF_DATAPOINTS], self._calibrating_entities)

            # Unset the datapoint.
            user_input.pop(CONF_DATAPOINTS)

        if sensor_issues:
            sensor_issues = "\n- ".join(sensor_issues)
            sensor_issues = f"\nProblematic Sensors: \n- { sensor_issues }"
        else:
            sensor_issues = ""

        return self.async_show_form(
            step_id="add_calibration_datapoints",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_DATAPOINTS): vol.Coerce(float),
                }
            ),
            errors=self._errors,
            description_placeholders={
                CONF_ENTITY_ID: "\n- " + "\n- "
                    .join([f"{ entity_id }:\n { self._config_entries[entity_id].options.get(CONF_DATAPOINTS) }\n" for entity_id in sorted(self._calibrating_entities) ]),
                CONF_TRACKED_ENTITY_ID: sensor_issues
            }
        )
