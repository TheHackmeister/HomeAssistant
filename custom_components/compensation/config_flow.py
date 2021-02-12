"""Config flow for the Compesation integration."""
import logging

import voluptuous as vol

from homeassistant import config_entries

from .const import (
    CONF_CALIBRATED_ENTITY_ID,
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
    MATCH_DATAPOINT,
)

from homeassistant.const import (
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
)
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
            _LOGGER.warning("Made it in user_input: %s", user_input)

            await self.async_set_unique_id( user_input.get(CONF_CALIBRATED_ENTITY_ID, f"{ user_input[CONF_ENTITY_ID] }{ DEFAULT_CALIBRATED_POSTFIX }") )
            self._abort_if_unique_id_configured()

            _LOGGER.warning("Made it in user_input: %s", user_input)
            return self.async_create_entry(
                title=f"{ self.unique_id }",
                data={
                    CONF_ENTITY_ID: user_input[CONF_ENTITY_ID],
                    CONF_CALIBRATED_ENTITY_ID: self.unique_id,
                    CONF_NAME: user_input[CONF_NAME],
                    CONF_ATTRIBUTE: user_input.get(CONF_ATTRIBUTE,None),
                    CONF_PRECISION: user_input[CONF_PRECISION],
                    CONF_DEGREE: user_input[CONF_DEGREE],
                    CONF_UNIT_OF_MEASUREMENT: user_input[CONF_UNIT_OF_MEASUREMENT],
                },
            )
            _LOGGER.warning("Made it in user_input: %s", user_input)
        else:
            _LOGGER.warning("Not it in user_input: %s", user_input)
            user_input = {}
        
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITY_ID): vol.In(
                        { ent.entity_id: f"{ ent.name } ({ ent.entity_id })" for ent in self.hass.states.async_all(DOMAIN_SENSOR) }
                    ),
                    vol.Optional(CONF_CALIBRATED_ENTITY_ID): cv.string,
                    vol.Optional(CONF_NAME, default=f"ORIGINAL_SENSOR_NAME Calibrated"): cv.string,
                    vol.Optional(CONF_ATTRIBUTE): cv.string,
                    vol.Optional(CONF_PRECISION, default=DEFAULT_PRECISION): cv.positive_int,
                    vol.Optional(CONF_DEGREE, default=DEFAULT_DEGREE): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=1, max=7),
                    ),
                    vol.Optional(CONF_UNIT_OF_MEASUREMENT, default=f"ORIGINAL_SENSORS_UNIT"): cv.string,
                }
            ),
            errors=self._errors,
        )

    async def async_step_import(self, user_input=None):
        """Import a config entry.
        Only host was required in the yaml file all other fields are optional
        """
        return await self.async_step_user(user_input)
