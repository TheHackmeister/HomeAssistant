"""The Compensation integration."""
import logging
import re
import warnings

import numpy as np
import voluptuous as vol

from homeassistant.components.sensor import DOMAIN as SENSOR_DOMAIN
from homeassistant.const import (
    CONF_ATTRIBUTE,
    CONF_ENTITY_ID,
    CONF_NAME,
    CONF_UNIT_OF_MEASUREMENT,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.discovery import async_load_platform

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

_LOGGER = logging.getLogger(__name__)


def datapoints_greater_than_degree(value: dict) -> dict:
    """Validate data point list is greater than polynomial degrees."""
    if not len(value[CONF_DATAPOINTS]) > value[CONF_DEGREE]:
        raise vol.Invalid(
            f"{CONF_DATAPOINTS} must have at least {value[CONF_DEGREE]+1} {CONF_DATAPOINTS}"
        )

    return value


COMPENSATION_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ENTITY_ID): cv.entity_id,
        vol.Required(CONF_DATAPOINTS): vol.All(
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


async def async_setup(hass, config):
    """Set up the Compensation sensor."""
    hass.data[DATA_COMPENSATION] = {}

    for compensation, conf in config.get(DOMAIN).items():
        _LOGGER.debug("Setup %s.%s", DOMAIN, compensation)

        degree = conf[CONF_DEGREE]

        datapoints = []
        for datapoint in conf[CONF_DATAPOINTS]:
            match = re.match(MATCH_DATAPOINT, datapoint)
            # we should always have x and y if the regex validation passed.
            x_value, y_value = [float(v) for v in match.groups()]
            datapoints.append((x_value, y_value))

        # get x values and y values from the x,y point pairs
        x_values, y_values = zip(*datapoints)

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

        if coefficients is not None:
            data = {
                k: v for k, v in conf.items() if k not in [CONF_DEGREE, CONF_DATAPOINTS]
            }
            data[CONF_POLYNOMIAL] = np.poly1d(coefficients)

            hass.data[DATA_COMPENSATION][compensation] = data

            hass.async_create_task(
                async_load_platform(
                    hass,
                    SENSOR_DOMAIN,
                    DOMAIN,
                    {CONF_COMPENSATION: compensation},
                    config,
                )
            )

    return True
