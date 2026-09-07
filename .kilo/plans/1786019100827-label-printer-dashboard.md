# Label Printer Dashboard — Implementation Plan

## Goal

Rebuild the label-printer dashboard around on-dashboard inputs:

1. User fills input helpers (mirroring the `script.print_label` fields)
2. Clicks **Preview Label** → render dry-run saves `www/labels/preview.png` → preview appears in the dashboard
3. Clicks **Send to Printer** → prints the same label
4. **Reset** button returns all label helpers to defaults

## Verified findings (what's wrong today)

1. **Dashboard has no inputs.** The buttons call `script.preview_label` / `script.print_label_send` with no data, so HA opens the script fields dialog instead of using dashboard fields.
2. **Stale preview image.** `type: picture` with a static `/local/labels/preview.png` URL is browser-cached; a newly rendered preview does not reliably appear.
3. **Triplicated field lists.** The 39-template and 90-icon select lists are copy-pasted across `print_label`, `preview_label`, and `print_label_send` in `scripts.yaml`.
4. **Bug in `script.print_label`:** `name_key: '{{ name_map.get(label_template) }}'` renders a `null` mapping as the string `"None"`, which is truthy — so for templates whose name/date mapping is `null` (e.g. `electronics/psu_polarity`, `utility/qr` date), a bogus `"None": <value>` field is injected into the API payload whenever name/date is provided. Same for `date_key`.
5. **Dashboard actions cannot contain Jinja** (HA limitation — "Templates are not allowed inside actions — call a script instead"). Buttons must call glue scripts that read the helpers.
6. **Safe deletions:** `preview_label` and `print_label_send` are referenced only by `dashboards/label-printer.yaml` (verified by repo grep; live `find_references` agrees). The printer service is up (`rest_command.label_printer_health` OK); the render→save pipeline works (`www/labels/preview.png` exists).

## Decisions (confirmed with user)

- **Helpers live in one package file** `packages/label_printer.yaml`. `homeassistant.packages: !include_dir_named packages` already exists, so **no `configuration.yaml` changes are needed** (this supersedes the original `label-helpers.yaml` + import idea, which YAML's one-domain-per-include rule makes impossible for `input_select` + `input_text`).
- `preview_path` stays plumbing: fixed to `preview.png`, no helper.
- Native cards only (entities / button / heading / markdown / grid) — no HACS card dependencies. Keep the existing `type: sections` view (live system is HA 2026.7.4).
- Icon input is an `input_select` mirroring the script's 90 Lucide options plus `'(none)'`.

## Changes

### 1. NEW `packages/label_printer.yaml`

Flat package body per repo convention (filename = pack name; **no** pack-name key inside the file — see `packages/package_vacuum.yaml`).

**`input_select:`**

| Entity | Options | initial |
|---|---|---|
| `label_template` | the 39 templates copied verbatim from the `print_label` field list | `kitchen/pantry_jar` |
| `label_tape_mm` | `'3.5'`, `'12'`, `'18'`, `'24'` | `'24'` |
| `label_date_preset` | `(none)`, `today`, `1 week from today`, `2 weeks from today`, `1 month from today`, `3 months from today` | `(none)` |
| `label_icon` | `(none)` + the 90 Lucide icon names copied verbatim from the `print_label` field list | `(none)` |

Give each a friendly name (`Label: Template`, `Label: Tape width (mm)`, …) and a sensible `mdi:` icon.

**`input_text:`** `label_name`, `label_date`, `label_extra_fields` (name it `Label: Extra fields (JSON object)`), `label_preview_token` (internal cache-buster; exclude from the dashboard inputs card).

**`script:`**

- `label_apply_from_helpers` — alias `Label: Apply From Dashboard`, `mode: single`, icon `mdi:label-printer`.
  - `fields.send`: boolean, required. (Both buttons pass it as a literal — no templates in the dashboard.)
  - Sequence:
    1. `action: script.print_label` with data: `label_template`/`tape_mm`/`name`/`date`/`date_preset` from helper states, `icon: "{{ '' if states('input_select.label_icon') == '(none)' else states('input_select.label_icon') }}"`, `send: "{{ send }}"`, `preview_path: preview.png`, `extra_fields: "{{ states('input_text.label_extra_fields') }}"` (print_label already `from_json`s strings and tolerates `''` via `default({}, true)`).
    2. `if: "{{ not (send | bool) }}"` → `input_text.set_value` `label_preview_token` to `{{ now().timestamp() | int }}`. (Runs only after a successful render — a failed `rest_command` stops the script, so a failed preview never bumps the token.)
- `label_reset_helpers` — alias `Label: Reset Helpers`, `mode: single`, icon `mdi:restore`.
  - `input_select.select_option`: template → `kitchen/pantry_jar`, tape → `'24'`, date_preset → `(none)`, icon → `(none)`.
  - One `input_text.set_value` with `value: ''` targeting all four `input_text` entities (entity list).

### 2. `scripts.yaml`

- **Delete** `preview_label:` (lines 7408–7619) and `print_label_send:` (lines 7620–7831) — replaced by the single glue script.
- **`print_label:` keep**, but fix the `"None"`-key bug:
  - `name_key: '{{ name_map.get(label_template) or "" }}'`
  - `date_key: '{{ date_map.get(label_template) or "" }}'`
- Otherwise unchanged — it keeps its field-based interface for other callers.

### 3. `dashboards/label-printer.yaml` — rebuild

Keep `type: sections`, `max_columns: 2`, title/path unchanged. Two sections:

**Section "Label options":**
- `heading` card: `Label Printer`, icon `mdi:label-printer`
- `entities` card "Label options" with the 7 user-facing helpers (selects render as dropdowns, texts as boxes; exclude `label_preview_token`)
- `grid` card (`columns: 3`, `square: false`) of three `button` cards:
  - **Preview Label** — `mdi:image-search`, `perform-action: script.label_apply_from_helpers`, `data: {send: false}`
  - **Send to Printer** — `mdi:printer`, same script, `data: {send: true}`, `confirmation: {text: "Send this label to the printer?"}`
  - **Reset** — `mdi:restore`, `perform-action: script.label_reset_helpers`, `confirmation: {text: "Reset all label fields to defaults?"}`

**Section "Preview":**
- `heading` card `Preview`, icon `mdi:image-search-outline`
- `markdown` card (cache-busting via the token; auto re-renders when the token changes):

```yaml
type: markdown
content: >
  {% if states('input_text.label_preview_token') not in ['', 'unknown', 'unavailable'] %}
  ![Label preview](/local/labels/preview.png?v={{ states('input_text.label_preview_token') }})
  {% else %}
  No preview yet — fill in the options and click **Preview Label**.
  {% endif %}
```

### 4. `configuration.yaml` — NO changes

Package dir already included. `rest_command.*` and `shell_command.save_label_preview` are correct as-is (`print_label` rest command hardcodes `"send": true` and is only ever called on the send path; the shell command already writes to `/config/www/labels/`, served at `/local/labels/`).

## Validation

1. YAML-lint every new/edited file.
2. After deploying to the live config: MCP `homeassistant_validate_config`, then reload helpers/scripts (or restart).
3. End-to-end via MCP: set helpers (e.g. template `kitchen/leftover`, name `Test`), call `script.label_apply_from_helpers` `{send: false}` → confirm `www/labels/preview.png` mtime bumped and `input_text.label_preview_token` set; call with `{send: true}` → label prints; call `script.label_reset_helpers` → all helpers back to defaults.
4. Open `/label-printer` dashboard: dropdowns/text boxes render; after Preview, the image updates with no manual refresh.

## Risks / notes

- Invalid JSON in `label_extra_fields` fails the run with a dashboard error toast — acceptable; the entity name says "JSON object".
- `print_label` is `mode: single`; a second click while a render/print runs is ignored — acceptable for a printer.
- Regression check for the `name_key` fix: preview a `null`-mapped template (e.g. `electronics/psu_polarity`) with a Name set and confirm no `"None"` key reaches the API.
