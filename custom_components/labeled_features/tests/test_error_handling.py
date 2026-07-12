"""Unit tests for the error-handling module.

These tests use lightweight fakes rather than a full HA harness so they run
without the pytest-homeassistant-custom-component plugin. When run inside a
full HA test environment they still pass.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from custom_components.labeled_features import error_handling as eh


class _FakeServices:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def async_call(self, domain, service, data, blocking=False):  # noqa: D401
        self.calls.append((domain, service, data))


def _fake_hass() -> SimpleNamespace:
    return SimpleNamespace(services=_FakeServices())


def test_normalize_error_mode_defaults_to_log():
    assert eh.normalize_error_mode(None) == "log"
    assert eh.normalize_error_mode("") == "log"
    assert eh.normalize_error_mode("bogus") == "log"
    assert eh.normalize_error_mode("SILENT") == "silent"
    assert eh.normalize_error_mode(" Stop ") == "stop"


def test_silent_is_a_noop():
    hass = _fake_hass()
    asyncio.run(
        eh.async_handle_error(
            hass, error_mode="silent", source="LF", message="x"
        )
    )
    assert hass.services.calls == []


def test_log_writes_system_log():
    hass = _fake_hass()
    asyncio.run(
        eh.async_handle_error(hass, error_mode="log", source="LF", message="boom")
    )
    assert hass.services.calls
    domain, service, data = hass.services.calls[0]
    assert (domain, service) == ("system_log", "write")
    assert data["level"] == "warning"
    assert "boom" in data["message"]


def test_alert_fires_configured_script():
    hass = _fake_hass()
    asyncio.run(
        eh.async_handle_error(
            hass,
            error_mode="alert",
            source="LF",
            message="alarm",
            alert_script="script.send_alert",
        )
    )
    domain, service, data = hass.services.calls[0]
    assert (domain, service) == ("script", "send_alert")
    assert data["alert_message"] == "alarm"


def test_stop_raises():
    hass = _fake_hass()
    with pytest.raises(eh.LabeledFeatureStop):
        asyncio.run(
            eh.async_handle_error(
                hass, error_mode="stop", source="LF", message="fatal"
            )
        )
