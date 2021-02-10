"""Config flow for the Compesation integration."""
import logging

import voluptuous as vol

from homeassistant import config_entries
from .const import DOMAIN # pylint: disable=unused-import


from homeassistant.const import (
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
)

from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.discovery import async_load_platform
#from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import HomeAssistantType

from .const import (
    CONF_COMPENSATION,
    CONF_DATAPOINTS,
    CONF_DEGREE,
    CONF_POLYNOMIAL,
    CONF_PRECISION,
    DATA_COMPENSATION,
    DEFAULT_DEGREE,
    DEFAULT_NAME,
    DEFAULT_PRECISION,
    DOMAIN,
    MATCH_DATAPOINT,
)

from . import COMPENSATION_SCHEMA

# TODO: Add TRACKED_ENTITY to const.py
TRACKED_ENTITY = 'tracked_entity'

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
            tracked_entity = user_input[CONF_ENTITY_ID]

            await self.async_set_unique_id(f"{ tracked_entity }")
            self._abort_if_unique_id_configured()

            _LOGGER.warning("Made it in user_input: %s", user_input)
            return self.async_create_entry(
                title=f"{ tracked_entity }",
                data={
                },
            )
            _LOGGER.warning("Made it in user_input: %s", user_input)
        else:
            _LOGGER.warning("Not it in user_input: %s", user_input)
            user_input = {}
            user_input[CONF_ENTITY_ID] = TRACKED_ENTITY
        
        _LOGGER.warning(f"COMPENSATION_SCHEMA: { COMPENSATION_SCHEMA.extend({}) }")

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITY_ID): str, #cv.entity_id,
                    #vol.Required(CONF_DATAPOINTS): vol.All(
                    #    cv.ensure_list(cv.matches_regex(MATCH_DATAPOINT)),
                    #),
                    vol.Optional(CONF_NAME, default=DEFAULT_NAME): cv.string,
                    vol.Optional(CONF_ATTRIBUTE): cv.string,
                    vol.Optional(CONF_PRECISION, default=DEFAULT_PRECISION): cv.positive_int,
                    vol.Optional(CONF_DEGREE, default=DEFAULT_DEGREE): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=1, max=7),
                    ),
                    vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
                }
            ),
            #    {
            #        vol.Required(TRACKED_ENTITY): str,
            #    }
            #),
            errors=self._errors,
        )

    async def async_step_import(self, user_input=None):
        """Import a config entry.
        Only host was required in the yaml file all other fields are optional
        """
        return await self.async_step_user(user_input)
