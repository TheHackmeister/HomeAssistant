"""The Compensation integration."""
import asyncio
import logging
import re
import warnings
import json

from datetime import timedelta
import numpy as np
import voluptuous as vol

from homeassistant import core, config_entries
from homeassistant.components.sensor import DOMAIN as DOMAIN_SENSOR
from homeassistant.components.mqtt import publish
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
    EVENT_HOMEASSISTANT_STARTED,
)
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.discovery import async_load_platform
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.helpers.typing import HomeAssistantType
from homeassistant.util import dt as dt_util

from .const import (
    CONF_COMPENSATION,
    CONF_DATAPOINTS,
    CONF_DEGREE,
    CONF_MQTT_PREFIX,
    CONF_MQTT_TOPIC,
    CONF_POLYNOMIAL,
    CONF_PRECISION,
    CONF_TRACKED_ENTITY_ID,
    DATA_COMPENSATION,
    DEFAULT_CALIBRATED_POSTFIX,
    DEFAULT_DEGREE,
    DEFAULT_NAME,
    DEFAULT_PRECISION,
    DOMAIN,
    MATCH_DATAPOINT,
)

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=300)

def datapoints_greater_than_degree(value: dict) -> dict:
    """Validate data point list is greater than polynomial degrees."""
    if not len(value[CONF_DATAPOINTS]) > value[CONF_DEGREE]:
        raise vol.Invalid(
            f"{CONF_DATAPOINTS} must have at least {value[CONF_DEGREE]+1} {CONF_DATAPOINTS}"
        )

    return value


COMPENSATION_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_TRACKED_ENTITY_ID): cv.entity_id,
        vol.Optional(CONF_DATAPOINTS): vol.All(
            cv.ensure_list(cv.matches_regex(MATCH_DATAPOINT)),
        ),
        vol.Optional(CONF_NAME, default=DEFAULT_NAME): cv.string,
        vol.Optional(CONF_ATTRIBUTE): cv.string,
        vol.Optional(CONF_PRECISION, default=DEFAULT_PRECISION): cv.positive_int,
        vol.Optional(CONF_DEGREE, default=DEFAULT_DEGREE): vol.All(
            vol.Coerce(int),
            vol.Range(min=1, max=7),
        ),
        vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
    }
)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {cv.slug: vol.All(COMPENSATION_SCHEMA, datapoints_greater_than_degree)}
        )
    },
    extra=vol.ALLOW_EXTRA,
)

async def async_setup_entry(hass: HomeAssistantType, entry: ConfigEntry) -> bool:
    """Set up the esphome component."""
    hass.data.setdefault(DATA_COMPENSATION, {})

    if entry.unique_id == CONF_MQTT_PREFIX:
        _LOGGER.warning("Skipping %s.", CONF_MQTT_PREFIX)
        return False

    datapoints = entry.options.get(CONF_DATAPOINTS, [(1,1), (2,2)])

    hass_data = calculate_poly(entry.data, datapoints)

    ## Registers update listener to update config entry when options are updated.
    ## Store a reference to the unsubscribe function to cleanup if an entry is unloaded.
    unsub_options_update_listener = entry.add_update_listener(options_update_listener)
    hass.data[DATA_COMPENSATION][entry.unique_id] = hass_data
    hass.data[DATA_COMPENSATION][entry.unique_id]["unsub_options_update_listener"] = unsub_options_update_listener

    hass.async_create_task(
        hass.config_entries.async_forward_entry_setup(entry, "sensor")
    )
    return True

async def async_setup(hass, config):
    """Set up the Compensation sensor."""
    hass.data[DATA_COMPENSATION] = {}
    already_discovered = set()

    for compensation, conf in config.get(DOMAIN, {}).items():
        _LOGGER.debug("Setup %s.%s", DOMAIN, compensation)


        datapoints = []
        for datapoint in conf[CONF_DATAPOINTS]:
            match = re.match(MATCH_DATAPOINT, datapoint)
            # we should always have x and y if the regex validation passed.
            x_value, y_value = [float(v) for v in match.groups()]
            datapoints.append((x_value, y_value))

        hass.data[DATA_COMPENSATION][compensation] = calculate_poly(conf, datapoints)

        hass.async_create_task(
            async_load_platform(
                hass,
                DOMAIN_SENSOR,
                DOMAIN,
                {CONF_COMPENSATION: compensation},
                config,
            )
        )

    @callback
    def async_take_reading(call):
        _LOGGER.warning(f"call: { call }")
        if call.data['entities_list_attribute'] in hass.states.get(call.data["entities_list"]).attributes:
            entities_array = json.loads(hass.states.get(call.data["entities_list"]).attributes[call.data["entities_list_attribute"]])
        else:
            _LOGGER.warning(f"No entities passed in via { call.data['entities_list'] }.{ call.data['entities_list_attribute'] }.")
            return
        if len(entities_array) > 0:
            take_reading(hass, hass.states.get(hass.states.get(call.data["known_good_entity"]).state).state, entities_array)

    hass.services.async_register(DOMAIN, "take_reading", async_take_reading) 

    @callback
    def async_delete_datapoints(call):
        _LOGGER.warning(f"call: { call }")
        delete_datapoints(hass, json.loads(hass.states.get(call.data["entities_list"]).attributes[call.data["entities_list_attribute"]]))

    hass.services.async_register(DOMAIN, "delete_datapoints", async_delete_datapoints)

    async def new_service_found(entity_id):
        """Handle a new service if one is found."""

        already_discovered.update( set( entity[CONF_TRACKED_ENTITY_ID] for entity in hass.data[DATA_COMPENSATION].values() ))
        if entity_id in already_discovered:
            _LOGGER.debug("Already discovered calibrated sensor: %s.", entity_id)
            return

        already_discovered.add(entity_id)
        return await hass.config_entries.flow.async_init(
            DOMAIN,
            # "source" translates to the config_flow step called.
            context={"source": "import", 'title_placeholders': { CONF_ENTITY_ID: entity_id} },
            data={CONF_TRACKED_ENTITY_ID: entity_id},
        )

    @callback
    def async_send_calibration_to_mqtt(call):
        _LOGGER.warning(f"call: { call }")

        for entity in json.loads(hass.states.get(call.data["entities_list"]).attributes[call.data["entities_list_attribute"]]):
            publish(hass,
                hass.states.get(entity).attributes[CONF_MQTT_TOPIC],
                json.dumps({
                    key: value for key, value in enumerate(hass.states.get(entity).attributes['coefficients'])
                }),
                1,
                True
            )

    hass.services.async_register(DOMAIN, "send_calibration_to_mqtt", async_send_calibration_to_mqtt)

    async def scan_devices(now):
        """Scan for devices."""
        try:
            results = await hass.async_add_executor_job(
                _discover, hass, already_discovered
            )

            for result in results:
                hass.async_create_task(new_service_found(result))
        finally:
            async_track_point_in_utc_time(
                hass, scan_devices, dt_util.utcnow() + SCAN_INTERVAL
            )

    @callback
    def schedule_first(event):
        """Schedule the first discovery when Home Assistant starts up."""
        async_track_point_in_utc_time(hass, scan_devices, dt_util.utcnow())

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, schedule_first)
    return True


def _discover(hass, already_discovered):
    """Discover devices."""
    results = []

    for state in sorted(
            hass.states.async_all(DOMAIN_SENSOR),
            key=lambda item: item.entity_id,
        ):
        if state.entity_id in already_discovered:
            continue
        if "_raw" in state.entity_id:
            results.append(state.entity_id)
    return results

def delete_datapoints(hass, entities):
    _LOGGER.warning(f"delete_datpoints: {entities}")
    config_entries = { entry.data[CONF_ENTITY_ID]: entry for entry in hass.config_entries.async_entries(DOMAIN) if CONF_ENTITY_ID in entry.data }
    for entity_id in entities:
        existing_data = config_entries[entity_id].options.get(CONF_DATAPOINTS, [])
        try:
            datapoints = [ ]
            entry = config_entries[entity_id]
            hass.config_entries.async_update_entry(entry, options={CONF_DATAPOINTS: datapoints})
        except (ValueError, TypeError, AttributeError) as e:
            _LOGGER.warning(f"Issue with datapoints: {e}")

def take_reading(hass, known_good_reading, entities_to_calibrate):
    _LOGGER.warning(f"Take reading: {entities_to_calibrate}")
    config_entries = { entry.data[CONF_ENTITY_ID]: entry for entry in hass.config_entries.async_entries(DOMAIN) if entry.data.get(CONF_ENTITY_ID, None)}
    for entity_id in entities_to_calibrate:
        existing_data = config_entries[entity_id].options.get(CONF_DATAPOINTS, [])
        try:
            datapoints = [ (
                float(hass.states.get(config_entries[entity_id].data.get(CONF_TRACKED_ENTITY_ID)).state),
                float(known_good_reading)
            ) ]
            datapoints.extend(existing_data)
            entry = config_entries[entity_id]

            _LOGGER.warning(f"Datapoints: {datapoints}")
            hass.config_entries.async_update_entry(entry, options={CONF_DATAPOINTS: datapoints})
        except (ValueError, TypeError, AttributeError) as e:
            _LOGGER.warning(f"Issue with datapoints: {e}")

def calculate_poly(conf, datapoints):
    # get x values and y values from the x,y point pairs
    degree = conf[CONF_DEGREE]
    try:
        x_values, y_values = zip(*datapoints)
        # If all values are 0, there ends up being a divide by 0 error.
        if len(x_values) == 1 and x_values[0] == 0:
            raise ValueError
    except ValueError:
        _LOGGER.warning(
            f"Warning: No calibration points set for { conf[CONF_ENTITY_ID] }. Will use trackted entity's state without modification."
        )
        x_values = [1,2]
        y_values = [1,2]

    # try to get valid coefficients for a polynomial
    coefficients = None
    with np.errstate(all="raise"):
        with warnings.catch_warnings(record=True) as all_warnings:
            warnings.simplefilter("always")
            # try to catch 3 possible errors
            try:
                coefficients = np.polyfit(x_values, y_values, degree)
            except (FloatingPointError, np.core._exceptions.UFuncTypeError) as error:
                _LOGGER.error(
                    "Setup of %s encountered an error, %s.",
                    conf[CONF_ENTITY_ID],
                    error,
                )
                coefficients = None

            # raise any warnings
            for warning in all_warnings:
                _LOGGER.warning(
                    "Setup of %s encountered a warning, %s.",
                    conf[CONF_ENTITY_ID],
                    str(warning.message).lower(),
                )

    data = {
        k: v for k, v in conf.items() if k not in [CONF_DEGREE, CONF_DATAPOINTS]
    }
    if coefficients is not None:
        data[CONF_POLYNOMIAL] = np.poly1d(coefficients)

    return data

async def options_update_listener(
    hass: HomeAssistantType, config_entry: ConfigEntry
):
    """Handle options update."""
    await hass.config_entries.async_reload(config_entry.entry_id)

async def async_unload_entry(hass, entry):
    """Unload a config entry."""
    unload_ok = all(
        await asyncio.gather(
            *[
                hass.config_entries.async_forward_entry_unload(entry, DOMAIN_SENSOR)
            ]
        )
    )

    hass.data[DATA_COMPENSATION][ entry.unique_id ]["unsub_options_update_listener"]()

    if unload_ok:
        hass.data[DATA_COMPENSATION].pop(entry.unique_id)

    return unload_ok
