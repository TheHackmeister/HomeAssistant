# Labeled Features

A native Home Assistant custom component that replaces the two trigger-based
template sensors at the heart of the [Label Based Features](https://curatedforest.com/tech/home-assistant/label-based-features/)
stack:

* **`sensor.<slug>_state`** — the leaders / features / snapshots engine.
  Reacts to state changes on entities carrying the gate label
  (default `feature_leader`) and to the `labeled_feature_set` /
  `labeled_feature_snapshot_set` events. Exposes the same
  `feature_meta`, `leaders`, `features`, `snapshots` attributes the existing
  automations and scripts consume.
* **`sensor.<slug>_areas_state`** — the `label_map` (Area-Based Features)
  engine. Reacts to label / area / floor registry updates and to
  `homeassistant.start`. Emits the flat `<scope_id>||<label>` → label_data
  map `automation.labeled_feature_areas` diffs directly.

Both entities keep the exact attribute schemas the existing production
YAML consumes — no automation or script changes are required for cutover.

## Phase 1 scope

This first release intentionally covers only the two state sensors and the
component-internal error handler. The rest of the label-based stack
(`Labeled Feature Leaders`, `Labeled Feature Areas`, all the follower /
button / area scripts) is unchanged and continues to run from
`automations.yaml` / `scripts.yaml`.

## Configuration

Add via **Settings → Devices & Services → Add Integration → Labeled
Features**. The default values reproduce the legacy `feature_leader` /
`labeled_features_state` / `labeled_feature_areas_state` behaviour, so zero
input is required for the common case.

| Field | Default | Notes |
|---|---|---|
| Engine name | `Labeled Features` | Drives the derived object_ids. |
| Gate label | `feature_leader` | Entity / area gate label. |
| State sensor object_id | `labeled_features_state` | Derived from engine name; can be overridden. |
| Areas sensor object_id | `labeled_feature_areas_state` | Derived from engine name; can be overridden. |
| Default area-feature component | `select` | Used by the `label_map` builder when no `Provides <F> Component:` override exists. |
| Default error mode | `log` | `silent` \| `log` \| `alert` \| `stop` — the tier the component uses for its *own* failures. |
| Alert script | `script.send_alert` | Fired when the `alert` tier is triggered. |
| Manual override event | `labeled_feature_set` | Consumed by the features engine. |
| Snapshot event | `labeled_feature_snapshot_set` | Consumed by the features engine. |
| feature_meta JSON override | (empty) | Optional JSON object merged over the built-in catalog. |

Multiple config entries create independent engines (different labels /
event names / object_ids) — useful if you want a second parallel
label-based stack for a subsystem.

## Migration from the YAML template sensors

Because the component pins its object_ids to the legacy defaults, the
cutover is a straight swap:

1. Install the component and configure with defaults.
2. Verify that `sensor.labeled_features_state` and
   `sensor.labeled_feature_areas_state` now come from the integration
   (Settings → Devices & Services → Labeled Features → their unique_ids
   will be `<entry_id>_state` / `<entry_id>_areas_state`).
3. Remove or comment out the two matching `- trigger: …` blocks in
   `configuration.yaml` (kept as `configuration.yaml.bak.featurestate`
   backup already).
4. Reload `Template` YAML (or restart Home Assistant).

Existing automations and scripts read the same attributes and keep
working unchanged.

## Development

Run the pure-logic unit tests from the HA config repo root:

```bash
pytest custom_components/labeled_features/tests
```

The tests stub a minimal `homeassistant` module so they run without
installing the full HA runtime; a real HA dev environment overrides the
stub automatically.
