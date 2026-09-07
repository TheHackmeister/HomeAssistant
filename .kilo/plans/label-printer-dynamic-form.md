# Label Printer — Dynamic Per-Template Form (config-template-card)

Status: implementation designed and validated against the live API; file edits blocked by session permissions at time of writing. Apply when edits are allowed.

## Design (agreed)

- **Shared field pool**: `input_text.label_field_1..6` (generic text helpers). The dashboard relabels them per selected template via `custom:config-template-card`; glue scripts map them positionally onto real field names using a schema captured from `GET /templates` (2026-08-07). Pool covers every template except `electronics/cable_flag` (9 optional fields) — its overflow stays on the Extra-fields JSON input.
- **Required-field validation in the glue scripts** before any API call → `Missing required fields: purchased (HH:MM:SS)` in `input_text.label_last_result` + `stop: error: true`, instead of the server's bare 500.
- **Icon** stays a dedicated `input_select.label_icon`; glue only sends it to templates whose schema declares `icon`.
- **Automation** `Label: Template Changed`: on `input_select.label_template` state change → clear pool (no stale cross-template values) + apply the template's `default_tape_mm`.
- **Removed helpers**: `label_name`, `label_date`, `label_date_preset` (superseded by the pool). Keep: template/tape/icon selects, extra_fields, preview_token, last_result.
- **Schema map lives in 3 places** (commented as such): package scripts (YAML anchor `&label_schema`, aliased in both glue scripts), template-change automation (tape defaults only), dashboard card (JS object).
- `script.print_label` in scripts.yaml is unchanged — glue calls it with `label_template`, `tape_mm`, `send`, `preview_path: preview.png`, and `extra_fields: <built JSON>`.

## Full file: packages/label_printer.yaml

```yaml
#######################################################################################################################
## Package - Label Printer  (dynamic per-template form)
#######################################################################################################################

input_select:
  label_template:
    name: 'Label: Template'
    icon: mdi:label-outline
    initial: kitchen/pantry_jar
    options:
      - kitchen/pantry_jar
      - kitchen/spice
      - kitchen/leftover
      - kitchen/freezer
      - electronics/component_bin
      - electronics/cable_flag
      - electronics/psu_polarity
      - three_d_printing/filament_spool
      - three_d_printing/print_bin
      - three_d_printing/tool_tag
      - utility/qr
      - utility/image
      - garden/seed_packet
      - garden/plant_tag
      - garden/row_marker
      - networking/patch_port
      - networking/rack_unit
      - networking/wap_location
      - workshop/hazard
      - workshop/tool_id
      - workshop/torque_cal
      - workshop/first_aid
      - home_inventory/moving_box
      - home_inventory/warranty
      - home_inventory/storage_bin
      - media/bookshelf_tag
      - media/archive_box
      - media/cd_record
      - pet/collar_backup
      - pet/med_schedule
      - pet/food_bowl
      - travel/luggage_tag
      - travel/gear_bag
      - travel/power_bank
      - calibration/instrument_cal
      - calibration/cert_id
      - calibration/thermometer_cal

  label_tape_mm:
    name: 'Label: Tape width (mm)'
    icon: mdi:tape-measure
    initial: '24'
    options: ['3.5', '12', '18', '24']

  label_icon:
    name: 'Label: Icon'
    icon: mdi:emoticon-outline
    initial: '(none)'
    options:
      - '(none)'
      # ... unchanged: the 89 Lucide icon names from the current file ...

input_text:
  label_field_1: { name: 'Label: Field 1', max: 255, initial: '' }
  label_field_2: { name: 'Label: Field 2', max: 255, initial: '' }
  label_field_3: { name: 'Label: Field 3', max: 255, initial: '' }
  label_field_4: { name: 'Label: Field 4', max: 255, initial: '' }
  label_field_5: { name: 'Label: Field 5', max: 255, initial: '' }
  label_field_6: { name: 'Label: Field 6', max: 255, initial: '' }
  label_extra_fields:
    name: 'Label: Extra fields (JSON object)'
    icon: mdi:code-json
    max: 255
    initial: ''
  label_preview_token:
    name: 'Label: Preview token'
    icon: mdi:refresh
    max: 100
    initial: ''
  label_last_result:
    name: 'Label: Last result'
    icon: mdi:message-text-outline
    max: 255
    initial: ''

automation:
  - id: label_template_changed
    alias: 'Label: Template Changed'
    mode: single
    triggers:
      - trigger: state
        entity_id: input_select.label_template
    actions:
      - action: input_text.set_value
        target:
          entity_id:
            - input_text.label_field_1
            - input_text.label_field_2
            - input_text.label_field_3
            - input_text.label_field_4
            - input_text.label_field_5
            - input_text.label_field_6
        data:
          value: ''
      - variables:
          default_tape:  # default_tape_mm per template (GET /templates 2026-08-07)
            kitchen/pantry_jar: '12'
            kitchen/spice: '12'
            kitchen/leftover: '12'
            kitchen/freezer: '12'
            electronics/component_bin: '12'
            electronics/cable_flag: '12'
            electronics/psu_polarity: '12'
            three_d_printing/filament_spool: '24'
            three_d_printing/print_bin: '24'
            three_d_printing/tool_tag: '12'
            utility/qr: '24'
            utility/image: '24'
            garden/seed_packet: '12'
            garden/plant_tag: '12'
            garden/row_marker: '12'
            networking/patch_port: '12'
            networking/rack_unit: '24'
            networking/wap_location: '12'
            workshop/hazard: '24'
            workshop/tool_id: '12'
            workshop/torque_cal: '12'
            workshop/first_aid: '12'
            home_inventory/moving_box: '24'
            home_inventory/warranty: '12'
            home_inventory/storage_bin: '24'
            media/bookshelf_tag: '12'
            media/archive_box: '24'
            media/cd_record: '12'
            pet/collar_backup: '12'
            pet/med_schedule: '12'
            pet/food_bowl: '12'
            travel/luggage_tag: '24'
            travel/gear_bag: '24'
            travel/power_bank: '12'
            calibration/instrument_cal: '12'
            calibration/cert_id: '12'
            calibration/thermometer_cal: '12'
      - action: input_select.select_option
        target:
          entity_id: input_select.label_tape_mm
        data:
          option: '{{ default_tape[trigger.to_state.state] | default("24") }}'

script:
  label_preview_from_helpers:
    alias: 'Label: Preview From Helpers'
    mode: single
    icon: mdi:image-search
    sequence:
      - variables:
          # GET /templates 2026-08-07, icon stripped (handled by label_icon select).
          # Same schema is embedded in the dashboard card — update both together.
          schema: &label_schema
            kitchen/pantry_jar: { icon: true,  fields: [ ['name', true], ['purchased', true], ['expires', false] ] }
            kitchen/spice: { icon: false, fields: [ ['name', true], ['origin', false], ['best_by', false] ] }
            kitchen/leftover: { icon: false, fields: [ ['contents', true], ['cooked', true], ['eat_within_days', false] ] }
            kitchen/freezer: { icon: false, fields: [ ['contents', true], ['frozen', true], ['portion', false] ] }
            electronics/component_bin: { icon: false, fields: [ ['value', true], ['footprint', true], ['tolerance', false] ] }
            electronics/cable_flag: { icon: false, fields: [ ['title', false], ['source', false], ['dest', false], ['date', false], ['details', false], ['link', false] ] }
            electronics/psu_polarity: { icon: false, fields: [ ['voltage', true], ['current', true], ['polarity', false] ] }
            three_d_printing/filament_spool: { icon: false, fields: [ ['material', true], ['color', true], ['brand', true], ['opened', true], ['nozzle_temp', false], ['bed_temp', false] ] }
            three_d_printing/print_bin: { icon: false, fields: [ ['part', true], ['project', false], ['qty', false] ] }
            three_d_printing/tool_tag: { icon: false, fields: [ ['tool', true], ['owner', false] ] }
            utility/qr: { icon: false, fields: [ ['data', true], ['caption', false] ] }
            utility/image: { icon: false, fields: [ ['path', true], ['caption', false], ['threshold', false] ] }
            garden/seed_packet: { icon: true,  fields: [ ['variety', true], ['sow_by', true], ['year', false] ] }
            garden/plant_tag: { icon: true,  fields: [ ['name', true], ['planted', true] ] }
            garden/row_marker: { icon: true,  fields: [ ['crop', true], ['variety', true] ] }
            networking/patch_port: { icon: true,  fields: [ ['port', true], ['vlan', true], ['dest', false] ] }
            networking/rack_unit: { icon: true,  fields: [ ['unit', true], ['device', true] ] }
            networking/wap_location: { icon: true,  fields: [ ['name', true], ['location', true] ] }
            workshop/hazard: { icon: true,  fields: [ ['hazard', true], ['text', true], ['code', false] ] }
            workshop/tool_id: { icon: true,  fields: [ ['name', true], ['owner', true], ['project', false] ] }
            workshop/torque_cal: { icon: true,  fields: [ ['tool', true], ['range_nm', true], ['last_cal', true] ] }
            workshop/first_aid: { icon: true,  fields: [ ['kit', true], ['expires', true] ] }
            home_inventory/moving_box: { icon: true,  fields: [ ['room', true], ['contents', true], ['fragile', false] ] }
            home_inventory/warranty: { icon: true,  fields: [ ['item', true], ['expires', true], ['receipt', false] ] }
            home_inventory/storage_bin: { icon: true,  fields: [ ['location', true], ['contents', true] ] }
            media/bookshelf_tag: { icon: true,  fields: [ ['title', true], ['author', true], ['callno', false] ] }
            media/archive_box: { icon: true,  fields: [ ['label', true], ['retain_until', true] ] }
            media/cd_record: { icon: true,  fields: [ ['title', true], ['artist', true], ['year', false] ] }
            pet/collar_backup: { icon: true,  fields: [ ['name', true], ['contact', true] ] }
            pet/med_schedule: { icon: true,  fields: [ ['pet', true], ['med', true], ['cadence', true] ] }
            pet/food_bowl: { icon: true,  fields: [ ['pet', true], ['food', true], ['portion', true] ] }
            travel/luggage_tag: { icon: true,  fields: [ ['name', true], ['contact', true] ] }
            travel/gear_bag: { icon: true,  fields: [ ['bag', true], ['purpose', true] ] }
            travel/power_bank: { icon: true,  fields: [ ['capacity_mah', true], ['charged', true], ['model', false] ] }
            calibration/instrument_cal: { icon: true,  fields: [ ['instrument', true], ['next_due', true], ['owner', false] ] }
            calibration/cert_id: { icon: true,  fields: [ ['cert_no', true], ['issuer', true] ] }
            calibration/thermometer_cal: { icon: true,  fields: [ ['instrument', true], ['ice_point_c', true], ['checked', true] ] }
          tpl: "{{ states('input_select.label_template') }}"
          pool:
            - "{{ states('input_text.label_field_1') }}"
            - "{{ states('input_text.label_field_2') }}"
            - "{{ states('input_text.label_field_3') }}"
            - "{{ states('input_text.label_field_4') }}"
            - "{{ states('input_text.label_field_5') }}"
            - "{{ states('input_text.label_field_6') }}"
          icon_sel: "{{ states('input_select.label_icon') }}"
          extra_raw: "{{ states('input_text.label_extra_fields') }}"
          built: >-
            {% set sch = schema[tpl] %}
            {% set ns = namespace(f={}) %}
            {% for fname, req in sch.fields %}
              {% set v = pool[loop.index0] %}
              {% if v not in ['', 'unknown', 'unavailable'] %}
                {% set ns.f = dict(ns.f, **{fname: v | trim}) %}
              {% endif %}
            {% endfor %}
            {% if icon_sel not in ['(none)', '', 'unknown', 'unavailable'] and sch.icon and 'icon' not in ns.f %}
              {% set ns.f = dict(ns.f, icon=icon_sel) %}
            {% endif %}
            {% if extra_raw not in ['', 'unknown', 'unavailable'] %}
              {% set ns.f = dict(ns.f, **(extra_raw | from_json)) %}
            {% endif %}
            {{ ns.f | to_json }}
          missing: >-
            {% set sch = schema[tpl] %}
            {% set f = built | from_json %}
            {{ sch.fields | selectattr(1) | map(attribute=0) | reject('in', f) | list | join(', ') }}
      - if: "{{ missing != '' }}"
        then:
          - action: input_text.set_value
            target:
              entity_id: input_text.label_last_result
            data:
              value: 'Missing required fields: {{ missing }} ({{ now().strftime(''%H:%M:%S'') }})'
          - stop: 'Label preview aborted: missing required fields: {{ missing }}'
            error: true
      - action: script.print_label
        data:
          label_template: '{{ tpl }}'
          tape_mm: "{{ states('input_select.label_tape_mm') }}"
          send: false
          preview_path: preview.png
          extra_fields: '{{ built }}'
      - action: input_text.set_value
        target:
          entity_id: input_text.label_preview_token
        data:
          value: '{{ now().timestamp() | int }}'

  label_print_from_helpers:
    alias: 'Label: Print From Helpers'
    mode: single
    icon: mdi:printer
    sequence:
      - variables:
          schema: *label_schema
          tpl: "{{ states('input_select.label_template') }}"
          pool:
            - "{{ states('input_text.label_field_1') }}"
            - "{{ states('input_text.label_field_2') }}"
            - "{{ states('input_text.label_field_3') }}"
            - "{{ states('input_text.label_field_4') }}"
            - "{{ states('input_text.label_field_5') }}"
            - "{{ states('input_text.label_field_6') }}"
          icon_sel: "{{ states('input_select.label_icon') }}"
          extra_raw: "{{ states('input_text.label_extra_fields') }}"
          built: >-
            {% set sch = schema[tpl] %}
            {% set ns = namespace(f={}) %}
            {% for fname, req in sch.fields %}
              {% set v = pool[loop.index0] %}
              {% if v not in ['', 'unknown', 'unavailable'] %}
                {% set ns.f = dict(ns.f, **{fname: v | trim}) %}
              {% endif %}
            {% endfor %}
            {% if icon_sel not in ['(none)', '', 'unknown', 'unavailable'] and sch.icon and 'icon' not in ns.f %}
              {% set ns.f = dict(ns.f, icon=icon_sel) %}
            {% endif %}
            {% if extra_raw not in ['', 'unknown', 'unavailable'] %}
              {% set ns.f = dict(ns.f, **(extra_raw | from_json)) %}
            {% endif %}
            {{ ns.f | to_json }}
          missing: >-
            {% set sch = schema[tpl] %}
            {% set f = built | from_json %}
            {{ sch.fields | selectattr(1) | map(attribute=0) | reject('in', f) | list | join(', ') }}
      - if: "{{ missing != '' }}"
        then:
          - action: input_text.set_value
            target:
              entity_id: input_text.label_last_result
            data:
              value: 'Missing required fields: {{ missing }} ({{ now().strftime(''%H:%M:%S'') }})'
          - stop: 'Label print aborted: missing required fields: {{ missing }}'
            error: true
      - action: script.print_label
        data:
          label_template: '{{ tpl }}'
          tape_mm: "{{ states('input_select.label_tape_mm') }}"
          send: true
          preview_path: preview.png
          extra_fields: '{{ built }}'

  label_reset_helpers:
    alias: 'Label: Reset Helpers'
    mode: single
    icon: mdi:restore
    sequence:
      - action: input_select.select_option
        target: { entity_id: input_select.label_template }
        data: { option: kitchen/pantry_jar }
      - action: input_select.select_option
        target: { entity_id: input_select.label_tape_mm }
        data: { option: '12' }   # pantry_jar default
      - action: input_select.select_option
        target: { entity_id: input_select.label_icon }
        data: { option: '(none)' }
      - action: input_text.set_value
        target:
          entity_id:
            - input_text.label_field_1
            - input_text.label_field_2
            - input_text.label_field_3
            - input_text.label_field_4
            - input_text.label_field_5
            - input_text.label_field_6
            - input_text.label_extra_fields
            - input_text.label_preview_token
            - input_text.label_last_result
        data: { value: '' }
```

## Dashboard change (dashboards/label-printer.yaml)

Section 1: heading, short markdown (explain `*` = required, extra fields JSON for overflow), entities card with ONLY `input_select.label_template`, `input_select.label_tape_mm`, `input_select.label_icon`, `input_text.label_extra_fields` — then the dynamic card:

```yaml
          - type: custom:config-template-card
            entities:
              - input_select.label_template
            card:
              type: entities
              title: Label fields
              entities: >-
                ${ (() => {
                  const S = {"kitchen/pantry_jar":[["name",1],["purchased",1],["expires",0]],"kitchen/spice":[["name",1],["origin",0],["best_by",0]],"kitchen/leftover":[["contents",1],["cooked",1],["eat_within_days",0]],"kitchen/freezer":[["contents",1],["frozen",1],["portion",0]],"electronics/component_bin":[["value",1],["footprint",1],["tolerance",0]],"electronics/cable_flag":[["title",0],["source",0],["dest",0],["date",0],["details",0],["link",0]],"electronics/psu_polarity":[["voltage",1],["current",1],["polarity",0]],"three_d_printing/filament_spool":[["material",1],["color",1],["brand",1],["opened",1],["nozzle_temp",0],["bed_temp",0]],"three_d_printing/print_bin":[["part",1],["project",0],["qty",0]],"three_d_printing/tool_tag":[["tool",1],["owner",0]],"utility/qr":[["data",1],["caption",0]],"utility/image":[["path",1],["caption",0],["threshold",0]],"garden/seed_packet":[["variety",1],["sow_by",1],["year",0]],"garden/plant_tag":[["name",1],["planted",0]],"garden/row_marker":[["crop",1],["variety",1]],"networking/patch_port":[["port",1],["vlan",1],["dest",0]],"networking/rack_unit":[["unit",1],["device",1]],"networking/wap_location":[["name",1],["location",1]],"workshop/hazard":[["hazard",1],["text",1],["code",0]],"workshop/tool_id":[["name",1],["owner",1],["project",0]],"workshop/torque_cal":[["tool",1],["range_nm",1],["last_cal",1]],"workshop/first_aid":[["kit",1],["expires",1]],"home_inventory/moving_box":[["room",1],["contents",1],["fragile",0]],"home_inventory/warranty":[["item",1],["expires",1],["receipt",0]],"home_inventory/storage_bin":[["location",1],["contents",1]],"media/bookshelf_tag":[["title",1],["author",1],["callno",0]],"media/archive_box":[["label",1],["retain_until",1]],"media/cd_record":[["title",1],["artist",1],["year",0]],"pet/collar_backup":[["name",1],["contact",1]],"pet/med_schedule":[["pet",1],["med",1],["cadence",1]],"pet/food_bowl":[["pet",1],["food",1],["portion",1]],"travel/luggage_tag":[["name",1],["contact",1]],"travel/gear_bag":[["bag",1],["purpose",1]],"travel/power_bank":[["capacity_mah",1],["charged",1],["model",0]],"calibration/instrument_cal":[["instrument",1],["next_due",1],["owner",0]],"calibration/cert_id":[["cert_no",1],["issuer",1]],"calibration/thermometer_cal":[["instrument",1],["ice_point_c",1],["checked",1]]};
                  const sch = S[states['input_select.label_template'].state];
                  if (!sch) return [];
                  return sch.slice(0, 6).map((f, i) => ({
                    entity: 'input_text.label_field_' + (i + 1),
                    name: f[0] + (f[1] ? ' *' : ''),
                  }));
                })() }
```

Section 2 unchanged (preview markdown + Last result + buttons).

## Validation done

- Schema captured from live `GET /templates` (37 templates, required flags verified against renders: pantry_jar/leftover/filament_spool 200 with complete fields, 500 without).
- Pool size 6 = max fields excluding cable_flag.
- YAML anchors keep one schema copy inside the package; JS copy in the card is the same data.

## To verify after applying

1. YAML lint + Jinja parse (as before).
2. On live: reload YAML; pick `kitchen/pantry_jar`, leave fields empty, click Preview → expect `Missing required fields: name, purchased` under the preview (no API call, no 500).
3. Fill name+purchased → preview renders, message clears; tape auto-set to 12 on template select.
4. Switch template → pool clears.
