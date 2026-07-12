"""Shared error-mode handling for the Labeled Features integration.

Ports the silent / log / alert / stop tiers from
``script.labeled_feature_error_mode`` so the component can handle its own
internal failures (bad label parse, registry lookup errors, evaluation
faults) with the same semantics the YAML scripts use.

The existing YAML scripts continue to use ``script.labeled_feature_error_mode``
untouched — this module is purely for the component's own code paths.

Behaviour per tier (matches the documented catalog):

    | Tier   | Action                                                        |
    |--------|---------------------------------------------------------------|
    | silent | No-op.                                                        |
    | log    | logger.warning + system_log at warning.                       |
    | alert  | Fire the configured alert script with severity/title/message. |
    | stop   | logger.error + system_log at error, then raise LabeledFeatureStop |

The ``stop`` tier raises ``LabeledFeatureStop`` so the caller can decide to
abort the current unit of work — mirroring the YAML pattern where the helper
logs and the caller follows up with its own ``stop: error: true``.
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant

from .const import (
    DEFAULT_ALERT_SCRIPT,
    DEFAULT_ERROR_MODE,
    ERROR_MODE_ALERT,
    ERROR_MODE_LOG,
    ERROR_MODE_SILENT,
    ERROR_MODE_STOP,
)

_LOGGER = logging.getLogger(__name__)


class LabeledFeatureStop(Exception):
    """Raised by :func:`async_handle_error` when the error mode is ``stop``.

    Callers should catch this to abort the current unit of work while
    letting the surrounding loop / entity continue.
    """


def normalize_error_mode(error_mode: str | None) -> str:
    """Return a valid, lower-cased error mode, defaulting to ``log``."""
    mode = (error_mode or DEFAULT_ERROR_MODE).strip().lower()
    if mode not in (
        ERROR_MODE_SILENT,
        ERROR_MODE_LOG,
        ERROR_MODE_ALERT,
        ERROR_MODE_STOP,
    ):
        return DEFAULT_ERROR_MODE
    return mode


async def async_handle_error(
    hass: HomeAssistant,
    *,
    error_mode: str | None,
    source: str,
    message: str,
    severity: str = "medium",
    alert_script: str = DEFAULT_ALERT_SCRIPT,
) -> None:
    """Dispatch an error through the configured tier.

    Args:
        hass: Home Assistant instance.
        error_mode: silent | log | alert | stop (case-insensitive).
        source: Short prefix identifying the caller (e.g. ``Labeled Features``).
        message: Human-readable description of what went wrong.
        severity: Severity forwarded to the alert tier (low | medium | high).
        alert_script: ``script.<name>`` entity id fired for the alert tier.

    Raises:
        LabeledFeatureStop: when ``error_mode`` resolves to ``stop``.
    """
    mode = normalize_error_mode(error_mode)
    prefixed = f"{source}: {message}"

    if mode == ERROR_MODE_SILENT:
        return

    if mode == ERROR_MODE_LOG:
        _LOGGER.warning(prefixed)
        await _async_system_log(hass, "warning", prefixed)
        return

    if mode == ERROR_MODE_ALERT:
        await _async_fire_alert(hass, alert_script, source, message, severity)
        return

    if mode == ERROR_MODE_STOP:
        _LOGGER.error(prefixed)
        await _async_system_log(hass, "error", prefixed)
        raise LabeledFeatureStop(prefixed)


async def _async_system_log(hass: HomeAssistant, level: str, message: str) -> None:
    """Write to HA's ``system_log`` (best-effort; never raises)."""
    try:
        await hass.services.async_call(
            "system_log",
            "write",
            {"level": level, "message": message},
            blocking=False,
        )
    except Exception:  # noqa: BLE001 - error handler must never itself raise
        _LOGGER.debug("system_log.write unavailable for message: %s", message)


async def _async_fire_alert(
    hass: HomeAssistant,
    alert_script: str,
    source: str,
    message: str,
    severity: str,
) -> None:
    """Fire the configured alert script (best-effort; never raises)."""
    if not alert_script or "." not in alert_script:
        _LOGGER.warning("%s: %s (alert script not configured)", source, message)
        return
    domain, _, obj = alert_script.partition(".")
    try:
        await hass.services.async_call(
            domain,
            obj,
            {
                "alert_severity": severity,
                "alert_title": source,
                "alert_message": message,
            },
            blocking=False,
        )
    except Exception:  # noqa: BLE001 - error handler must never itself raise
        _LOGGER.error("%s: %s (alert dispatch failed)", source, message)
