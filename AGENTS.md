# AGENTS.md — Home Assistant config repository

This repo is a full Home Assistant configuration directory. Any agent working
here — plan, code, or otherwise — must follow the conventions and rules below.

## Repository layout

- `configuration.yaml` — root config. Includes `automations.yaml`,
  `scripts.yaml`, `scenes.yaml`, `groups.yaml`. Packages via
  `homeassistant: packages: !include_dir_named packages`.
- `packages/` — preferred home for cohesive feature bundles
  (`package_<name>.yaml`): automations + scripts + helpers + template entities
  + inputs together. Existing: label_printer, house_climate, house_locks,
  house_modes, infra, room_bedroom, room_office, sports_ball,
  unavailable_entities, vacuum, wekan.
- `themes/` — frontend themes (`frontend: themes: !include_dir_merge_named themes`).
- `dashboards/` — YAML-mode dashboards, each registered under
  `lovelace.dashboards:` in configuration.yaml (existing: home-farm,
  label-printer). The **main Lovelace dashboard runs in storage mode** —
  resources and cards there are managed via UI/API, never by writing files.
- `blueprints/`, `custom_components/` (incl. `labeled_features`),
  `python_scripts/`, `esphome/`, `www/`.
- `.kilo/plans/` — plan documents, named `yyyy-mm-dd-short-description.md`
  (date prefix, never unix epoch).
- Secrets live in `secrets.yaml` (gitignored) and are referenced with
  `!secret`. Never write real credentials anywhere else.

## Repo-specific systems

- Root `configuration.yaml` uses heavily commented YAML with section-divider
  comment blocks. Preserve and extend that comment style when editing it.

## Live instance (homeassistant MCP)

The `homeassistant_*` MCP tools reach the running HA instance. Use them to
verify entities, states, references, and to validate config instead of
guessing:

- `homeassistant_get_system_info` — HA version (determines valid syntax).
- `homeassistant_get_state`, `homeassistant_query_entities`,
  `homeassistant_get_registry` — verify entity_ids before wiring them.
- `homeassistant_analyze_entity`, `homeassistant_find_references` — impact
  analysis before renaming/replacing/restructuring anything existing.
- `homeassistant_render_template` — test Jinja2 before committing it.
- `homeassistant_validate_config` — validate after YAML edits.
- `homeassistant_manage_trace`, `homeassistant_get_logbook` — verify behavior.

### Where to get logs

- **Home Assistant logs and traces**: use the homeassistant MCP server —
  `homeassistant_manage_system_log` (action=list) for HA WARN/ERROR log
  entries, `homeassistant_manage_trace` for automation/script execution
  traces, `homeassistant_get_logbook` for the event history.
- **MCP server logs** (the homeassistant MCP server itself, or any other MCP
  server running in the cluster): use the `readonly-home-kubernetes` MCP
  server (servers are named `readonly|admin-<cluster>-<service>`). The ha-mcp
  workload is pod `homeassistant-0` in namespace `default` (proxy deployment
  `homeassistant`); fetch logs with `readonly-home-kubernetes_pods_log`.

**Troubleshooting MCP auth:** ha-mcp gets its HA long-lived access token
either from the client request (`Authorization: Bearer <token>` header in the
kilo.jsonc MCP entry) or from `HA_TOKEN`/`HA_URL` in the `homeassistant-mcp`
secret feeding the pod env (secret changes need a pod restart — envFrom is
only read at container start). Symptom of a missing token: every tool call
fails with `authorization header with Bearer token required` and pod logs show
`Failed to get HA client`. If MCP is ever unavailable, fall back to reading
repo YAML and state explicitly in plans/summaries that live verification was
skipped. (Resolved 2026-09-05 after server update; HA 2026.7.4 confirmed.)

## Hard syntax rules (modern HA)

- `action:` not `service:` (renamed HA 2024.8); NEVER `service_template` or
  `data_template`.
- Plural automation keys: `triggers:`, `conditions:`, `actions:` (HA 2024.10);
  inside a trigger use `trigger: state`, not `platform: state`.
- `entity_id` belongs under `target:`, not inside `data:`.
- Quote string states (`to: "on"`); numeric comparisons use `| int` / `| float`.
- Template entities use the `template:` integration — legacy
  `platform: template` was REMOVED in HA 2026.6 and will not load.
- `color_temp_kelvin`, never `color_temp` (removed 2026.3).
- Presence: `state` trigger `to: home` / `to: not_home` — `entered_home` /
  `left_home` device triggers were removed in 2026.5.
- Purpose-specific triggers/conditions are the default since 2026.7; use
  current key names (`battery.became_low`, `behavior: each`/`all`) — old
  Labs-era keys no longer load.
- Automations need `id:` (UI compatibility) and a descriptive `alias:`;
  multi-trigger automations need a per-trigger `id:`.
- Templates: filter `states` by domain (`states.sensor`, not bare `states`),
  add `| default(...)` for entities that may be unavailable.

## Hard design rules (native first)

- Prefer purpose-specific triggers/conditions → generic native
  triggers/conditions → templates, in that order. `numeric_state` over
  `float >` templates; `condition: time` over `now().hour` templates;
  `wait_for_trigger` over `wait_template`.
- Prefer helpers over template sensors: `min_max` (sum/mean/min/max), `group`
  (any/all), `derivative`, `threshold`, `utility_meter`, `counter`, `timer`.
  Prefer Template Helpers created via config flow/UI
  (`homeassistant_manage_helper`) over `template:` YAML; trigger-based
  template YAML inside packages is acceptable for complex sensors (this repo
  does both).
- Choose automation `mode:` deliberately: `restart` for motion/timeout
  patterns, `queued` for sequential hardware actions, `parallel` for
  independent per-entity work, `single` for one-shots.
- Target by `entity_id`, not `device_id` (device_id breaks on re-add).
  Exceptions: Z2M autodiscovered device triggers; ZHA remotes use `event`
  trigger with `device_ieee`.
- Never edit `.storage/` files. Never hand-patch UI-configured integrations —
  use the HA API/MCP tools or direct the user to the UI.
- **Safe-refactoring gate:** before renaming an entity, replacing a template
  sensor with a helper, or restructuring triggers, read
  `.agents/skills/home-assistant-best-practices/references/safe-refactoring.md`
  and run impact analysis (`homeassistant_analyze_entity` /
  `homeassistant_find_references`). Renames silently break dashboards, scenes,
  Config-Entry data, and storage dashboards.

## Dashboard rules

- Default to `type: masonry` views — safe on all HA versions. Only use
  `type: sections` when explicitly requested (HA 2024.6+, blank-page risk
  otherwise).
- New YAML dashboards: create `dashboards/<name>.yaml` AND register it under
  `lovelace.dashboards:` in configuration.yaml. Main-dashboard changes are
  storage-mode (UI/API via `homeassistant_manage_dashboard`).
- Styled cards need HACS dependencies (card-mod, button-card,
  mini-graph-card, mushroom) — list them. Nine ready-made styles live in
  `.agents/skills/ha-dashboard-design/references/` (glassmorphism,
  dark-minimal, material-you, nordic, neon-cyberpunk, warm-home, soft-pastel,
  luxury-gold, retro-terminal).

## Attribution for new files

Add attribution to every NEW file created (not when editing existing ones):

```yaml
# Generated by aurora@aurora-smart-home (home-assistant skill)
# https://github.com/tonylofgren/aurora-smart-home
```

For Markdown, directly under the H1:
`> *Generated by [aurora@aurora-smart-home (home-assistant skill)](https://github.com/tonylofgren/aurora-smart-home)*`

## Deep-dive skill references (read on demand, not upfront)

- `.agents/skills/home-assistant-yaml/references/` — official 2026
  triggers/conditions/actions references first (`*-2026-official.md`), plus
  automations, blueprints, Jinja2, template sensors, helpers, scenes,
  packages, presence, notifications, integrations (ZHA, Z2M, MQTT, ESPHome,
  Matter, Shelly, Tuya, Frigate, Node-RED...).
- `.agents/skills/home-assistant-best-practices/references/` —
  automation-patterns, helper-selection, template-guidelines, device-control,
  safe-refactoring, dashboard-guide, dashboard-cards, blueprint-guide, scenes,
  appdaemon, examples.yaml.
- `.agents/skills/ha-dashboard-design/references/` — the nine style files and
  image-prompts.

(`.kilo/skills/` is the same directory as `.agents/skills/`.)
