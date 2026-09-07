# Label Printer — Helper-Free Custom Card Conversion

Decisions confirmed with user: auto-use physical tape (intended tape shown in template selector),
live reload always on. form-card alone can't do this (no per-field change_action; template select
inside the form is invisible to outer cards), so the design is ONE compact custom card.

Status: fully designed; file edits blocked by session permissions at time of writing.

## Architecture

- **New custom card** `label-printer-card` (`www/label-printer/card.js`): ha-form driven by the
  embedded template schema; all form state client-side; debounced (800ms) live preview on every
  change via `hass.callService('script', 'print_label', {send: false, ...})`; Send/Reset buttons;
  preview image + status + loaded-tape readout inside the card, driven by HA state
  (preview token / last result / tape sensor) so they stay correct for any caller.
- **print_label stays the engine.** One change: query `/status` at sequence start and override
  `tape_mm` with the physically loaded width (fallback: the passed field). Token bump and
  last-result writes stay in the engine (move the token bump from glue into the render-success
  path — glue scripts are deleted).
- **Deleted:** input_selects (template/tape/icon), pool input_texts (field_1..7), extra_fields,
  live_reload boolean, batch input_numbers/boolean, both automations, both glue scripts,
  reset script, icon picker section, config-template-card usage. **Kept helpers:**
  input_text.label_preview_token, input_text.label_last_result.
- **New REST sensor** `sensor.label_printer_status` (loaded tape + errors) for the card readout.

## 1. `www/label-printer/card.js` (new)

```js
// Label Printer card — helper-free dynamic form for the brother-ptouch-automation service.
class LabelPrinterCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._schema = config.schema || {};
    this._icons = config.icons || [];
    this._templates = Object.keys(this._schema);
    this._tokenEntity = config.token_entity || "input_text.label_preview_token";
    this._statusEntity = config.status_entity || "input_text.label_last_result";
    this._tapeSensor = config.tape_sensor || "sensor.label_printer_status";
    this._template = this._templates[0];
    this._data = this._defaults();
    this._build();
  }

  _defaults() {
    return { _template: this._template, _batch_size: 1, _gap_dots: 0, _cut_every: 0, _half_cut: true };
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    const token = hass.states[this._tokenEntity]?.state;
    if (token && token !== this._lastToken && !["", "unknown", "unavailable"].includes(token)) {
      this._lastToken = token;
      this._img.src = `/local/labels/preview.png?v=${token}`;
      this._img.style.display = "";
      this._placeholder.style.display = "none";
    }
    const status = hass.states[this._statusEntity]?.state;
    const show = status && !["", "unknown", "unavailable"].includes(status);
    this._statusEl.style.display = show ? "" : "none";
    if (show) this._statusEl.textContent = status;
    const tape = hass.states[this._tapeSensor]?.state;
    this._tapeEl.textContent = tape && !["unknown", "unavailable"].includes(tape)
      ? `Loaded tape: ${tape}` : "Loaded tape: unavailable";
  }

  _formSchema() {
    const t = this._schema[this._template];
    const schema = [{
      name: "_template",
      selector: { select: { options: this._templates.map((k) => ({ value: k, label: `${k} — ${this._schema[k].tape}mm` })) } },
    }];
    for (const [fname, req] of t.fields) schema.push({ name: fname, required: !!req, selector: { text: {} } });
    if (t.icon) schema.push({ name: "icon", selector: { select: { options: ["(none)", ...this._icons] } } });
    schema.push(
      { name: "_batch_size", selector: { number: { min: 1, max: 50, mode: "box" } } },
      { name: "_gap_dots", selector: { number: { min: 0, max: 200, mode: "box" } } },
      { name: "_cut_every", selector: { number: { min: 0, max: 50, mode: "box" } } },
      { name: "_half_cut", selector: { boolean: {} } },
    );
    return schema;
  }

  _labels = {
    _template: "Template", _batch_size: "Batch size (copies)",
    _gap_dots: "Gap between labels (dots)", _cut_every: "Full cut every N (0 = off)",
    _half_cut: "Half-cut between labels", icon: "Icon",
  };

  _computeLabel = (s) => {
    if (this._labels[s.name]) return this._labels[s.name];
    const f = this._schema[this._template].fields.find(([n]) => n === s.name);
    return f ? f[0] + (f[1] ? " *" : "") : s.name;
  };

  _build() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card { padding: 16px; }
      .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      @media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
      .buttons { display: flex; gap: 8px; margin-top: 12px; }
      .buttons ha-button { flex: 1; }
      .preview img { max-width: 100%; image-rendering: pixelated; background: #fff; }
      .meta { color: var(--secondary-text-color); font-size: 0.9em; margin-top: 8px; }
      .status { margin-top: 8px; font-weight: 500; }
    `;
    const card = document.createElement("ha-card");
    card.innerHTML = `
      <div class="wrap">
        <div class="form-col">
          <div class="form-host"></div>
          <div class="buttons">
            <ha-button class="preview-btn">Preview Label</ha-button>
            <ha-button class="print-btn">Send to Printer</ha-button>
            <ha-button class="reset-btn">Reset</ha-button>
          </div>
        </div>
        <div class="preview">
          <img style="display:none" alt="Label preview">
          <div class="placeholder meta">No preview yet — fill in the fields.</div>
          <div class="tape meta"></div>
          <div class="status"></div>
        </div>
      </div>`;
    this._img = card.querySelector("img");
    this._placeholder = card.querySelector(".placeholder");
    this._statusEl = card.querySelector(".status");
    this._tapeEl = card.querySelector(".tape");
    card.querySelector(".preview-btn").addEventListener("click", () => this._run(false));
    card.querySelector(".print-btn").addEventListener("click", () => this._print());
    card.querySelector(".reset-btn").addEventListener("click", () => this._reset());
    this.replaceChildren(style, card);
    this._rebuildForm();
  }

  _rebuildForm() {
    const host = this.querySelector(".form-host");
    host.replaceChildren();
    this._form = document.createElement("ha-form");
    this._form.hass = this._hass;
    this._form.schema = this._formSchema();
    this._form.data = this._data;
    this._form.computeLabel = this._computeLabel;
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const v = ev.detail.value;
      if (v._template !== this._template) {
        this._template = v._template;
        this._data = this._defaults();
        this._rebuildForm();
      } else {
        this._data = v;
      }
      this._debouncedPreview();
    });
    host.appendChild(this._form);
  }

  _debouncedPreview() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this._run(false), this._config.debounce_ms ?? 800);
  }

  _payload(send) {
    const d = this._data;
    const fields = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith("_") && v !== "" && v != null && v !== "(none)") fields[k] = v;
    }
    return {
      label_template: d._template, send, preview_path: "preview.png",
      extra_fields: fields,
      copies: d._batch_size ?? 1, gap_dots: d._gap_dots ?? 0,
      cut_every: d._cut_every ?? 0, half_cut: d._half_cut ?? true,
    };
  }

  async _run(send) {
    if (!this._hass) return;
    try {
      await this._hass.callService("script", "print_label", this._payload(send));
    } catch (e) {
      this._statusEl.textContent = e.message || String(e);
      this._statusEl.style.display = "";
    }
  }

  _print() { if (window.confirm("Send this label to the printer?")) this._run(true); }
  _reset() { this._data = this._defaults(); this._rebuildForm(); this._debouncedPreview(); }
  getCardSize() { return 8; }
}
customElements.define("label-printer-card", LabelPrinterCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "label-printer-card", name: "Label Printer Card",
  description: "Dynamic form for the label printer service (helper-free)." });
```

## 2. `configuration.yaml`

```yaml
lovelace:
  resources:
    - url: /local/label-printer/card.js
      type: module
  dashboards:  # unchanged
    ...

rest:
  - resource: https://brother-ptouch-automation.spencerslab.com/status
    scan_interval: 120
    sensor:
      - name: Label printer status
        value_template: "{{ value_json.tape_mm ~ ' mm' if value_json.get('ok') else 'unavailable' }}"
        json_attributes:
          - errors
          - has_media
```

## 3. `scripts.yaml` — print_label sequence start (physical tape wins)

Insert before the existing first `- variables:` step:

```yaml
    - action: rest_command.label_printer_status
      response_variable: printer_status
      continue_on_error: true
    - variables:
        # Physical tape wins: preview and print target what's actually loaded.
        tape_mm: >-
          {%- if printer_status is defined and printer_status.content is mapping and printer_status.content.get('ok') -%}
          {{ printer_status.content.tape_mm }}
          {%- else -%}
          {{ tape_mm | default('24') }}
          {%- endif %}
```

And in the render-success path (else branch), after `shell_command.save_label_preview`, keep the
last-result clear AND add the token bump (moved from the deleted glue script):

```yaml
        - action: input_text.set_value
          target:
            entity_id: input_text.label_preview_token
          data:
            value: '{{ now().timestamp() | int }}'
```

## 4. `packages/label_printer.yaml` — slim to engine-output helpers only

```yaml
input_text:
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
```

(Everything else in the package is deleted.)

## 5. `dashboards/label-printer.yaml` — full rewrite

```yaml
views:
  - type: sections
    max_columns: 2
    title: Label Printer
    path: label-printer
    sections:
      - type: grid
        cards:
          - type: heading
            heading: Label Printer
            icon: mdi:label-printer
          - type: custom:label-printer-card
            tape_sensor: sensor.label_printer_status
            icons: [<the 89 lucide names>]
            schema:
              kitchen/pantry_jar: { tape: 12, icon: true, fields: [[name, true], [purchased, true], [expires, false]] }
              # ... all 37 templates from the current package schema (tape/icon/fields) ...
```

Schema source: `packages/label_printer.yaml` current `schema` anchor + tape defaults from the
automation map (merge into one `{tape, icon, fields}` per template — matches /tmp/kilo/schema_map.json).

## Validation done / to do

- form-card source-verified: only save_action; `value-changed` fires with full form data
  (hence the custom card instead).
- To do when applying: node syntax check on card.js; YAML lints; verify resource loads
  (browser hard-refresh); preview/print/reset round-trip on live.
