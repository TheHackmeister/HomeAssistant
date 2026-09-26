# Plan: Styrbar arrow buttons, Somrig 1_long_press → Media Input, Symfonisk parity

## Goal
Give the IKEA STYRBAR's four arrow events real behavior (`arrow_right_click` →
`Eating`, `arrow_right_hold` → `Bright`, `arrow_left_click` → toggle `Night`,
`arrow_left_hold` → `Lights Off`), change the IKEA SOMRIG `1_long_press`
Not-Playing branch from `Lights Up` to a `Media Input` toggle, verify the
SYMFONISK package already matches the button-label-mapping docs, and update the
published spec docs in CuratedForest.com to match. `Eating` and `Media Input`
are new **label-only** generic features — they need no catalog/feature_meta
entries and no component changes; they resolve through
`(Area |Floor |)Follower: <Feature>` labels via generics' existing
unknown-feature delegation path.

## Skills
- `labeled-features` — the spec overlay for this system (case-sensitivity rules, generics resolution, frozen attribute contract).
- `home-assistant-yaml` — modern HA script syntax.
- `home-assistant-best-practices` — editing existing production scripts.

## MCP Servers
- `admin-global-homeassistant` / `readonly-global-homeassistant` — config validation, script traces, live label checks. **Not exposed in the planning session**; the Code agent must run the live checks listed under Verification. If they are unavailable to the Code agent too, follow AGENTS.md fallback and state that live verification was skipped.

## Verified context
- Repo state: worktree clean at `57630f4` (packages split); CuratedForest.com label-based-features section clean at `3032280`. No pending edits on either side.
- Docs ↔ YAML relationship: docs are the target design; for **symfonisk the user explicitly designated the docs as source of truth** ("make sure the package implements what is defined in button-label-mapping").
- Line-by-line doc-table ↔ YAML comparison for `script.labeled_feature_symfonisk`: **already in parity** (13 events; transport global; volume rocker area/hold-split; all six dots_* branches force `toggle: true`; `dots_1_long_press` floor-scoped `Bright`; ignored `*_initial_press`/`*_long_release`). No change expected.
- `labeled_feature_generics` implements the unknown/label-only feature path (`feature_meta.kind == "unknown"` → per-entity fan-out to `script.labeled_feature_follower`, both toggle and non-toggle variants) — confirmed in `package_labeled_features_generics.yaml` (~lines 531–551, 953–990).
- Night mode wiring: `input_select.house_mode` (Day/Night/Away) drives `input_boolean.night_mode` via the House Mode automations; labeled-features equivalent is leader labels on `input_select.house_mode` (per `production-objects.md`). Symfonisk already toggles generic `Night` globally (`scope: none`, `toggle: true`) — styrbar will mirror that.
- Files: `packages/package_labeled_features_styrbar.yaml` (256 lines), `package_labeled_features_somrig.yaml` (449), `package_labeled_features_symfonisk.yaml` (548), docs page `CuratedForest.com/content/tech/home-assistant/label-based-features/button-label-mapping/index.md`.
- Live verification: **skipped in planning** (homeassistant MCP tools not exposed this session) — Code agent must verify live.

## Design decisions
1. **`Eating`, `Media Input` (and `Bright`) are label-only features, not catalog entries.** Adding catalog/feature_meta entries would require custom-component changes (Phase 2, needs explicit approval). The unknown-feature delegation path covers "toggle/enable these labeled things" exactly. Rule: catalog is reserved for non-trivial dispatch logic (generic-features doc, line 69).
2. **Scope answers confirmed by the user:**
   - `arrow_right_hold` → `Bright` at **floor scope** (same feature symfonisk `dots_1_long_press` already dispatches floor-wide; reuses the same `Floor Follower: Bright` labels).
   - `arrow_left_click` → `Night` toggle at **global scope (`scope: none`)** — mirrors symfonisk `dots_2_double_press` and the house-wide night mode.
   - Somrig `1_long_press` **Playing branch stays `Volume Up`**; only Not-Playing changes (`Lights Up` → `Media Input` toggle).
3. **Toggle semantics follow the user's wording:** only explicitly-`Toggle`d actions force `toggle: true` (`Night` on arrow_left_click, `Media Input` on somrig). `Eating`, `Bright`, `Lights Off` pass the caller's `toggle` through (default false = enable/disable), matching "turn on lights/scenes" intent and the existing somrig precedent (`2_double_press` forces Night toggle; light branches pass through).
4. **Styrbar prologue gains floor resolution.** Bright at floor scope needs `_resolved_floor_id`; port the `_resolved_area_id` + `_resolved_floor_id` variable blocks verbatim from `package_labeled_features_symfonisk.yaml` (lines 165–206) so the prologues stay identical across the script family. Styrbar still does **not** compute `media_playing` (no media-dependent branches).
5. **Somrig `1_long_press` keeps a single templated generics call** (same shape as `2_double_press`): templated `feature` + templated `toggle`. `Media Input` is label-only so the hold loop doesn't apply to it; forwarding `leader_entity_id` stays harmless pass-through.
6. **Mapping scripts never call services directly** — every new branch goes through `script.labeled_feature_generics` with the full standard pass-through field set, `exclude_feature: '{{ _leader_feature }}'` included (button-label-mapping doc rule).
7. **Case sensitivity:** feature names are exactly `Eating`, `Bright`, `Media Input`, `Night`, `Lights Off` — capitalized everywhere (the rule that bites everyone).

## Changes

### 1. `packages/package_labeled_features_styrbar.yaml` — MODIFY
**a)** In the Step 1 `variables:` block, after `_event:`, add `_resolved_area_id` and `_resolved_floor_id` copied verbatim from `package_labeled_features_symfonisk.yaml` lines 165–206 (the version whose `_resolved_floor_id` else-branch derives the floor id even for non-floor scopes — needed so `arrow_right_hold` can dispatch floor-scoped regardless of caller scope):
```yaml
          _resolved_area_id: >-
            {%- if _scope == 'area' and scope_id is defined and scope_id != '' -%}
              {{ scope_id }}
            {%- elif follower_entity_id is defined and follower_entity_id != '' -%}
              {{ area_id(follower_entity_id) | default('') }}
            {%- elif leader_entity_id is defined and leader_entity_id != '' -%}
              {{ area_id(leader_entity_id) | default('') }}
            {%- else -%}{{ '' }}{%- endif -%}
          _resolved_floor_id: >-
            {%- if _scope == 'floor' and scope_id is defined and scope_id != '' -%}
              {{ scope_id }}
            {%- elif _scope == 'floor' and follower_entity_id is defined and follower_entity_id != '' -%}
              {%- set aid = area_id(follower_entity_id) -%}
              {%- set ns = namespace(found='') -%}
              {%- for fid in floors() -%}
                {%- if aid in floor_areas(fid) -%}{%- set ns.found = fid -%}{%- endif -%}
              {%- endfor -%}{{ ns.found }}
            {%- elif _scope == 'floor' and leader_entity_id is defined and leader_entity_id != '' -%}
              {%- set aid = area_id(leader_entity_id) -%}
              {%- set ns = namespace(found='') -%}
              {%- for fid in floors() -%}
                {%- if aid in floor_areas(fid) -%}{%- set ns.found = fid -%}{%- endif -%}
              {%- endfor -%}{{ ns.found }}
            {%- else -%}
              {# Derive the floor id even for non-floor scopes so the
                 arrow_right_hold Floor Bright branch has a scope_id. #}
              {%- set aid = _resolved_area_id -%}
              {%- if aid == '' and follower_entity_id is defined and follower_entity_id != '' -%}
                {%- set aid = area_id(follower_entity_id) | default('') -%}
              {%- endif -%}
              {%- if aid == '' and leader_entity_id is defined and leader_entity_id != '' -%}
                {%- set aid = area_id(leader_entity_id) | default('') -%}
              {%- endif -%}
              {%- set ns = namespace(found='') -%}
              {%- if aid != '' -%}
                {%- for fid in floors() -%}
                  {%- if aid in floor_areas(fid) -%}{%- set ns.found = fid -%}{%- endif -%}
                {%- endfor -%}
              {%- endif -%}
              {{ ns.found }}
            {%- endif -%}
```
**b)** Replace the four `sequence: []` TODO stubs:
```yaml
          # ────────────── arrow_left_click ──────────────
          # Toggle house-wide night mode: generic Night at global scope,
          # forced toggle:true (mirrors symfonisk dots_2_double_press).
          - conditions:
              - condition: template
                value_template: '{{ _event == "arrow_left_click" }}'
            sequence:
              - action: script.labeled_feature_generics
                data:
                  feature: Night
                  exclude_feature: '{{ _leader_feature }}'
                  scope: none
                  scope_id: ''
                  follower_entity_id: '{{ follower_entity_id | default("") }}'
                  leader_entity_id: '{{ leader_entity_id | default("") }}'
                  leader_enabled: '{{ leader_enabled | default(true) }}'
                  toggle: true
                  error_mode: '{{ _err_mode }}'

          # ────────────── arrow_left_hold ──────────────
          # Area Lights Off, one-shot.
          - conditions:
              - condition: template
                value_template: '{{ _event == "arrow_left_hold" }}'
            sequence:
              - action: script.labeled_feature_generics
                data:
                  feature: Lights Off
                  exclude_feature: '{{ _leader_feature }}'
                  scope: '{{ _scope }}'
                  scope_id: '{{ scope_id | default("") }}'
                  follower_entity_id: '{{ follower_entity_id | default("") }}'
                  leader_entity_id: '{{ leader_entity_id | default("") }}'
                  leader_enabled: '{{ leader_enabled | default(true) }}'
                  toggle: '{{ _toggle_in }}'
                  error_mode: '{{ _err_mode }}'

          # ────────────── arrow_right_click ──────────────
          # User-defined label-only feature Eating (area scope) — resolves
          # via (Area )Follower: Eating labels; enable semantics (toggle
          # pass-through).
          - conditions:
              - condition: template
                value_template: '{{ _event == "arrow_right_click" }}'
            sequence:
              - action: script.labeled_feature_generics
                data:
                  feature: Eating
                  exclude_feature: '{{ _leader_feature }}'
                  scope: '{{ _scope }}'
                  scope_id: '{{ scope_id | default("") }}'
                  follower_entity_id: '{{ follower_entity_id | default("") }}'
                  leader_entity_id: '{{ leader_entity_id | default("") }}'
                  leader_enabled: '{{ leader_enabled | default(true) }}'
                  toggle: '{{ _toggle_in }}'
                  error_mode: '{{ _err_mode }}'

          # ────────────── arrow_right_hold ──────────────
          # User-defined label-only feature Bright — floor-scoped, the same
          # floor-wide Bright symfonisk dots_1_long_press dispatches.
          - conditions:
              - condition: template
                value_template: '{{ _event == "arrow_right_hold" }}'
            sequence:
              - action: script.labeled_feature_generics
                data:
                  feature: Bright
                  exclude_feature: '{{ _leader_feature }}'
                  scope: floor
                  scope_id: '{{ _resolved_floor_id }}'
                  follower_entity_id: '{{ follower_entity_id | default("") }}'
                  leader_entity_id: '{{ leader_entity_id | default("") }}'
                  leader_enabled: '{{ leader_enabled | default(true) }}'
                  toggle: '{{ _toggle_in }}'
                  error_mode: '{{ _err_mode }}'
```
**c)** Rewrite the `description:` mapping block (lines ~24–42): drop the "lights-only / reserved for future use" framing; new table:
`on → Lights On`, `off → Lights Off`, `brightness_move_up → Lights Up (hold loop)`, `brightness_move_down → Lights Down (hold loop)`, `brightness_stop → ignored`, `arrow_left_click → Night (toggle:true, scope: none)`, `arrow_left_hold → Lights Off (area)`, `arrow_right_click → Eating (area, label-only)`, `arrow_right_hold → Bright (floor, label-only)`, `arrow_left_release / arrow_right_release → ignored`. Note that `Eating`/`Bright` resolve via Follower labels and that the script still computes no `media_playing`.

### 2. `packages/package_labeled_features_somrig.yaml` — MODIFY
**a)** Replace the `1_long_press` branch's generics call data (branch condition unchanged):
```yaml
              - action: script.labeled_feature_generics
                data:
                  feature: '{{ "Volume Up" if media_playing else "Media Input" }}'
                  exclude_feature: '{{ _leader_feature }}'
                  scope: '{{ _scope }}'
                  scope_id: '{{ scope_id | default("") }}'
                  follower_entity_id: '{{ follower_entity_id | default("") }}'
                  leader_entity_id: '{{ leader_entity_id | default("") }}'
                  leader_enabled: '{{ leader_enabled | default(true) }}'
                  toggle: '{{ true if not media_playing else _toggle_in }}'
                  error_mode: '{{ _err_mode }}'
```
**b)** Update the comment block above the branch: Playing → `Volume Up` stepping (hold loop via `leader_entity_id`, unchanged); Not Playing → `Media Input` **toggle, fires once** — label-only feature, so the generics hold loop does not apply (same shape as `2_long_press` Not-Playing `Ads` and `2_double_press` Not-Playing `Night`).
**c)** Update the script `description:` table row: `1_long_press     Playing: Volume Up                  Not Playing: Media Input (toggle:true)`.
**d)** Update `fields.toggle.description`: the forced-toggle override now applies to the `1_double_press` Not-Playing branch **and** the `1_long_press` Not-Playing branch.

### 3. `packages/package_labeled_features_symfonisk.yaml` — VERIFY (no change expected)
Re-check every row of the button-label-mapping docs' symfonisk table against the YAML (event, media_playing split, scope, toggle). Planning comparison found full parity; if the Code agent's deeper pass finds any divergence, fix the **YAML to match the docs** (docs are the designated source of truth for this script).

### 4. `CuratedForest.com/content/tech/home-assistant/label-based-features/button-label-mapping/index.md` — MODIFY
**a) Somrig section:**
- Table row (line 62): `| \`1_long_press\` | \`Volume Up\` | \`Media Input\` (with \`toggle: true\`) |`
- Toggle paragraph (line 67): forced `toggle: true` now applies to **both** `1_double_press` Not-Playing (`Fan On`) and `1_long_press` Not-Playing (`Media Input`); every other branch passes through.
- Long-press paragraph (line 69): only **two** stepping long-press branches remain (`1_long_press` Playing `Volume Up`, `2_long_press` Playing `Volume Down`); add that `1_long_press` Not-Playing now dispatches `Media Input` as a toggle that runs once, exactly like the `2_long_press` Not-Playing `Ads` toggle.
- Add one sentence: `Media Input` is user-defined (no `feature_meta` entry) and resolves via `(Area |Floor |)Follower: Media Input` labels, like `Screen`/`TV Input` on symfonisk.
**b) Styrbar section:**
- Replace the lights-only/reserved paragraph (line 76): the arrow events are implemented; `arrow_left_click` forces `toggle: true`; `Eating` and `Bright` are user-defined label-only features.
- Table rows 91–94:
  - `arrow_left_click` → `Night` with `toggle: true`, `scope: none` (global — toggles house-wide night mode, mirrors symfonisk `dots_2_double_press`)
  - `arrow_left_hold` → `Lights Off` (one-shot, area scope)
  - `arrow_right_click` → `Eating` (area scope, label-only)
  - `arrow_right_hold` → `Bright` (floor scope resolved from leader/follower via `floor_areas()`, label-only — same floor-wide `Bright` as symfonisk `dots_1_long_press`)
- Fix the "(all area-scoped)" table heading — scopes are now mixed (area default; Night global; Bright floor).
- Adjust line 97: the script still does not compute `media_playing` (no media-dependent branches), but the prologue now also resolves the leader's floor id for the floor-scoped `Bright` branch (mirrors the symfonisk prologue).
**c)** Leave untouched: front matter, `{{< examples >}}` shortcode, `examples.md` stub, `generic-features/index.md` (its "or any user-defined feature" wording already covers Eating/Media Input), `production-objects.md` (no objects moved).

## Verification
1. `homeassistant_validate_config` after each package edit (or once after both).
2. Live label check (MCP): which entities currently carry `Follower: Bright`, `Follower: Eating`, `Follower: Media Input`, `Follower: Night` labels — report in the summary so the user knows which buttons will resolve today and which will raise Error Mode until labeled.
3. Trace-test each changed script via manual dispatch (`homeassistant_manage_trace`):
   - `script.labeled_feature_styrbar` with `feature: arrow_left_click` (+ a real `leader_entity_id`/`follower_entity_id` from a wired styrbar) → expect one `labeled_feature_generics` call, `Night`/`none`/`toggle: true`.
   - Same for `arrow_left_hold` (Lights Off, area), `arrow_right_click` (Eating, area), `arrow_right_hold` (Bright, floor + resolved floor id — verify `_resolved_floor_id` is non-empty for a real area).
   - `script.labeled_feature_somrig` with `feature: 1_long_press` while nothing plays → `Media Input` with `toggle: true`; while something plays in scope → `Volume Up` with caller toggle.
4. Confirm no Error Mode entries beyond the expected "no followers labeled yet" ones (`homeassistant_manage_system_log`).
5. Symfonisk: fire/trace one event per branch class (transport, volume tap, volume hold, one dots button) to confirm behavior unchanged.
6. Docs: re-read the edited page end-to-end; confirm tables render (pipe escaping), internal links unchanged.

## Risks & open questions
- **Unlabeled new features raise Error Mode (log tier)** on press until the user labels followers (`Area Follower: Eating`, `(Area |Floor |)Follower: Media Input`). Expected system behavior — surface it in the final summary with the exact label strings to add.
- `_resolved_floor_id` is `''` when the leader/follower area belongs to no floor → floor-scoped `Bright` resolves nothing → Error Mode. Same existing behavior as symfonisk; acceptable.
- Live instance was not reachable in the planning session (homeassistant MCP tools not exposed); all entity/label claims above come from repo YAML. Code agent must re-verify live before finalizing.
- Two repos are touched (HomeAssistant worktree + CuratedForest.com) — separate commits; docs edits publish to the website, so preserve Hugo front matter/shortcodes exactly.
- Feature names are case-sensitive contract strings: `Eating`, `Bright`, `Media Input`, `Night` — any casing drift silently breaks resolution.
