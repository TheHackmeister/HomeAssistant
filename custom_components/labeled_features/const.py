"""Constants for the Labeled Features integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "labeled_features"

# ─────────────────────────────────────────────────────────────────────
# Config-entry option keys
# ─────────────────────────────────────────────────────────────────────
CONF_ENGINE_NAME: Final = "engine_name"
CONF_GATE_LABEL: Final = "gate_label"
CONF_DEFAULT_COMPONENT: Final = "default_component"
CONF_DEFAULT_ERROR_MODE: Final = "default_error_mode"
CONF_ALERT_SCRIPT: Final = "alert_script"
CONF_SET_EVENT: Final = "set_event"
CONF_SNAPSHOT_EVENT: Final = "snapshot_event"
CONF_FEATURE_META: Final = "feature_meta"

# The confirmed final object_ids (derived from the engine name, but shown in
# the flow so the user can pin them). Keeping them explicit means the entity
# registry unique_id is stable even if the engine name is later renamed.
CONF_STATE_OBJECT_ID: Final = "state_object_id"
CONF_AREAS_OBJECT_ID: Final = "areas_object_id"

# ─────────────────────────────────────────────────────────────────────
# Defaults (mirror the legacy template-sensor behavior exactly)
# ─────────────────────────────────────────────────────────────────────
DEFAULT_ENGINE_NAME: Final = "Labeled Features"
DEFAULT_GATE_LABEL: Final = "feature_leader"
DEFAULT_COMPONENT: Final = "select"
DEFAULT_ERROR_MODE: Final = "log"
DEFAULT_ALERT_SCRIPT: Final = "script.send_alert"
DEFAULT_SET_EVENT: Final = "labeled_feature_set"
DEFAULT_SNAPSHOT_EVENT: Final = "labeled_feature_snapshot_set"

# For the default engine name the legacy entity_ids were:
#   sensor.labeled_features_state       (plural "features")
#   sensor.labeled_feature_areas_state  (singular "feature")
# These are the historical object_ids the existing automations/scripts
# reference, so the default engine name maps onto them exactly.
DEFAULT_STATE_OBJECT_ID: Final = "labeled_features_state"
DEFAULT_AREAS_OBJECT_ID: Final = "labeled_feature_areas_state"

# ─────────────────────────────────────────────────────────────────────
# Error-mode tiers
# ─────────────────────────────────────────────────────────────────────
ERROR_MODE_SILENT: Final = "silent"
ERROR_MODE_LOG: Final = "log"
ERROR_MODE_ALERT: Final = "alert"
ERROR_MODE_STOP: Final = "stop"
ERROR_MODES: Final = [
    ERROR_MODE_SILENT,
    ERROR_MODE_LOG,
    ERROR_MODE_ALERT,
    ERROR_MODE_STOP,
]

# ─────────────────────────────────────────────────────────────────────
# feature_meta — single source of truth catalog of built-in generic
# features. Mirrors the `feature_meta` attribute emitted by the legacy
# template sensor (configuration.yaml). Each entry keyed by canonical
# Feature Name → {domain, kind, domain_label}.
# ─────────────────────────────────────────────────────────────────────
DEFAULT_FEATURE_META: Final[dict[str, dict[str, str]]] = {
    "Media Toggle": {"domain": "media_player", "kind": "media_toggle", "domain_label": "Media Player"},
    "Media Play": {"domain": "media_player", "kind": "media_play", "domain_label": "Media Player"},
    "Media Pause": {"domain": "media_player", "kind": "media_pause", "domain_label": "Media Player"},
    "Media Next": {"domain": "media_player", "kind": "media_next", "domain_label": "Media Player"},
    "Media Previous": {"domain": "media_player", "kind": "media_previous", "domain_label": "Media Player"},
    "Media Seek Back": {"domain": "media_player", "kind": "media_seek_back", "domain_label": "Media Player"},
    "Media Seek Forward": {"domain": "media_player", "kind": "media_seek_forward", "domain_label": "Media Player"},
    "Volume Up": {"domain": "media_player", "kind": "volume_up", "domain_label": "Media Player"},
    "Volume Down": {"domain": "media_player", "kind": "volume_down", "domain_label": "Media Player"},
    "Lights On": {"domain": "light", "kind": "light_on", "domain_label": "Light"},
    "Lights Off": {"domain": "light", "kind": "light_off", "domain_label": "Light"},
    "Lights Up": {"domain": "light", "kind": "light_up", "domain_label": "Light"},
    "Lights Down": {"domain": "light", "kind": "light_down", "domain_label": "Light"},
    "Fan On": {"domain": "fan", "kind": "fan_on", "domain_label": "Fan"},
    "Fan Off": {"domain": "fan", "kind": "fan_off", "domain_label": "Fan"},
    "Fan Up": {"domain": "fan", "kind": "fan_up", "domain_label": "Fan"},
    "Fan Down": {"domain": "fan", "kind": "fan_down", "domain_label": "Fan"},
}

# Truthy state set for the default truth function (case-insensitive).
TRUTHY_STATES: Final = frozenset(
    {"on", "true", "home", "open", "detected", "active", "unlocked"}
)

# Domains whose entities always evaluate to enabled (no persistent boolean
# state — every change is a "fire").
ALWAYS_TRUE_DOMAINS: Final = frozenset({"event", "button"})

# States considered "not real" (boot restore / reconnect noise).
UNREAL_STATES: Final = frozenset({"unknown", "unavailable", "none"})

PLATFORMS: Final = ["sensor"]
