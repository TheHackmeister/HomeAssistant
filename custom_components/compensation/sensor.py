"""Support for compensation sensor."""
import logging

import numpy as np

from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_UNIT_OF_MEASUREMENT,
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
    STATE_UNKNOWN,
)
from homeassistant.core import callback
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.event import async_track_state_change_event

from homeassistant.components.sensor import DOMAIN as DOMAIN_SENSOR
from .const import CONF_COMPENSATION, CONF_POLYNOMIAL, CONF_PRECISION, DATA_COMPENSATION, CONF_TRACKED_ENTITY_ID

_LOGGER = logging.getLogger(__name__)

ATTR_ATTRIBUTE = "attribute"
ATTR_COEFFICIENTS = "coefficients"


async def async_setup_platform(hass, config, async_add_entities, discovery_info=None):
    """Set up the Compensation sensor."""
    if discovery_info is not None:
        entity_id = discovery_info.get(CONF_COMPENSATION)
        conf = hass.data[DATA_COMPENSATION][entity_id]

        async_add_entities(
            [
                CompensationSensor(
                    hass,
                    f"{ DOMAIN_SENSOR }.{ entity_id }",
                    conf[CONF_TRACKED_ENTITY_ID],
                    conf.get(CONF_NAME),
                    conf.get(CONF_ATTRIBUTE),
                    conf[CONF_PRECISION],
                    conf[CONF_POLYNOMIAL],
                    conf.get(CONF_UNIT_OF_MEASUREMENT),
                )
            ]
        )

async def async_setup_entry(hass, entry, async_add_entries):
    """Set up the sensor platform."""
    conf = hass.data[DATA_COMPENSATION][entry.unique_id]

    entity = CompensationSensor(
        hass,
        conf[CONF_ENTITY_ID],
        conf[CONF_TRACKED_ENTITY_ID],
        conf.get(CONF_NAME),
        conf.get(CONF_ATTRIBUTE),
        conf[CONF_PRECISION],
        conf.get(CONF_POLYNOMIAL, np.poly1d(1)),
        conf.get(CONF_UNIT_OF_MEASUREMENT),
    )

    async_add_entries([entity])


class CompensationSensor(Entity):
    """Representation of a Compensation sensor."""

    def __init__(
        self,
        hass,
        entity_id,
        tracked_entity_id,
        name,
        attribute,
        precision,
        polynomial,
        unit_of_measurement,
    ):
        """Initialize the Compensation sensor."""
        self._entity_id = entity_id
        self._tracked_entity_id = tracked_entity_id
        self._name = name
        self._precision = precision
        self._attribute = attribute
        self._attributes = {}
        self._unit_of_measurement = unit_of_measurement
        self._poly = polynomial
        self._coefficients = polynomial.coefficients.tolist()

        if hass.states.get(self._tracked_entity_id):
            self.calc_state(hass.states.get(self._tracked_entity_id))
        else:
            self._state = STATE_UNKNOWN

        @callback
        def async_compensation_sensor_state_listener(event):
            """Handle sensor state changes."""
            new_state = event.data.get("new_state")
            self.calc_state(new_state)
            self.async_write_ha_state()

        async_track_state_change_event(
            hass, [tracked_entity_id], async_compensation_sensor_state_listener
        )

    def calc_state(self, new_state):
        if new_state is None:
            return

        self._attributes.update(new_state.attributes)

        if self._unit_of_measurement is None and self._attribute is None:
            self._unit_of_measurement = new_state.attributes.get(
                ATTR_UNIT_OF_MEASUREMENT
            )

        try:
            if self._attribute:
                value = float(new_state.attributes.get(self._attribute))
            else:
                value = (
                    None
                    if new_state.state == STATE_UNKNOWN
                    else float(new_state.state)
                )
            # Calculate the result
            self._state = round(self._poly(value), self._precision)

        except (ValueError, TypeError):
            self._state = STATE_UNKNOWN
            if self._attribute:
                _LOGGER.warning(
                    "%s attribute %s is not numerical",
                    self._entity_id,
                    self._attribute,
                )
            else:
                _LOGGER.warning("%s state is not numerical", self._entity_id)

    @property
    def entity_id(self):
        """Return the entity_id of the sensor."""
        return self._entity_id
    @entity_id.setter
    def entity_id(self, ent_id):
        self._entity_id = ent_id

    @property
    def tracked_entity_id(self):
        """Return the tracked entity_id of the sensor."""
        return self._tracked_entity_id

    @property
    def name(self):
        """Return the name of the sensor."""
        return self._name

    @property
    def should_poll(self):
        """No polling needed."""
        return False

    @property
    def state(self):
        """Return the state of the sensor."""
        return self._state

    @property
    def device_state_attributes(self):
        """Return the state attributes of the sensor."""
        ret = {
            ATTR_ENTITY_ID: self._entity_id,
            ATTR_COEFFICIENTS: self._coefficients,
        }
        if self._attribute:
            ret[ATTR_ATTRIBUTE] = self._attribute
        if self._attributes:
            ret.update(self._attributes)
        return ret

    @property
    def unit_of_measurement(self):
        """Return the unit the value is expressed in."""
        return self._unit_of_measurement
