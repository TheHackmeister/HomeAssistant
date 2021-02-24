"""The Compensation integration."""
import logging
import re
import warnings

from datetime import timedelta
import numpy as np
import voluptuous as vol

from homeassistant import core, config_entries
from homeassistant.components.sensor import DOMAIN as DOMAIN_SENSOR
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

    datapoints = entry.options.get(CONF_DATAPOINTS, [(1,1), (2,2)])

    hass_data = calculate_poly(entry.data, datapoints)

    ## Registers update listener to update config entry when options are updated.
    unsub_options_update_listener = entry.add_update_listener(options_update_listener)
    ## Store a reference to the unsubscribe function to cleanup if an entry is unloaded.
    hass_data["unsub_options_update_listener"] = unsub_options_update_listener
    hass.data[DATA_COMPENSATION][entry.unique_id] = hass_data

    hass.async_create_task(
        hass.config_entries.async_forward_entry_setup(entry, "sensor")
    )
    return True

async def async_setup(hass, config):
    """Set up the Compensation sensor."""
    hass.data[DATA_COMPENSATION] = {}
    already_discovered = set()

    for compensation, conf in config.get(DOMAIN).items():
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

    async def scan_devices(now):
        """Scan for devices."""
        try:
            results = await hass.async_add_executor_job(
                _discover, hass, already_discovered
            )

            for result in results:
                hass.async_create_task(new_service_found(result))

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

def calculate_poly(conf, datapoints):
    # get x values and y values from the x,y point pairs
    degree = conf[CONF_DEGREE]
    y_values, x_values = zip(*datapoints)

    # try to get valid coefficients for a polynomial
    coefficients = None
    with np.errstate(all="raise"):
        with warnings.catch_warnings(record=True) as all_warnings:
            warnings.simplefilter("always")
            # try to catch 3 possible errors
            try:
                coefficients = np.polyfit(x_values, y_values, degree)
            except FloatingPointError as error:
                _LOGGER.error(
                    "Setup of %s encountered an error, %s.",
                    compensation,
                    error,
                )
            # raise any warnings
            for warning in all_warnings:
                _LOGGER.warning(
                    "Setup of %s encountered a warning, %s.",
                    compensation,
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
    #pass
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

    hass.data[DOMAIN][entry.entry_id]["unsub_options_update_listener"]()

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok
