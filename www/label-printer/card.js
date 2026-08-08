// Label Printer card — helper-free dynamic form for the brother-ptouch-automation service.
//
// All form state is client-side. Fields regenerate per selected template from
// the embedded schema (mirrors GET /templates). Every change debounces into a
// live preview via script.print_label (send=false); the engine writes the
// preview token / last-result helpers and the card follows them via HA state.
//
// Prefill modes (select under Template): empty required fields can be
// pre-filled with their own field name so the preview shows the field mapping
// ("required" default, "all", or "none"). Date fields prefill to today's date
// instead (any mode except "none") and get +1 week / +1 month quick buttons.

// Field names that hold dates across the template schema (ISO YYYY-MM-DD).
const DATE_FIELDS = new Set([
  "purchased", "expires", "cooked", "frozen", "opened", "sow_by", "planted",
  "last_cal", "checked", "retain_until", "next_due", "charged", "best_by", "date",
]);

const isoDate = (d) => d.toISOString().slice(0, 10);
const today = () => isoDate(new Date());
const plusWeek = () => isoDate(new Date(Date.now() + 7 * 86400000));
const plusMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return isoDate(d);
};

class LabelPrinterCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._schema = config.schema || {};
    this._icons = config.icons || [];
    this._templates = Object.keys(this._schema);
    this._iconBase = config.icon_base_url ||
      "https://brother-ptouch-automation.spencerslab.com/icons";
    this._tokenEntity = config.token_entity || "input_text.label_preview_token";
    this._statusEntity = config.status_entity || "input_text.label_last_result";
    this._tapeSensor = config.tape_sensor || "sensor.label_printer_status";
    this._template = this._templates[0];
    this._data = this._defaults();
    this._applyPrefill();
    this._build();
  }

  _defaults() {
    return {
      _template: this._template,
      _prefill: "required",
      _batch_size: 1,
      _gap_dots: 0,
      _cut_every: 0,
      _half_cut: true,
    };
  }

  _applyPrefill() {
    const mode = this._data._prefill;
    for (const [fname, req] of this._schema[this._template].fields) {
      if (DATE_FIELDS.has(fname)) {
        // Dates prefill to today instead of the field-name placeholder.
        this._data[fname] = mode === "none" ? "" : (mode === "all" || req) ? today() : "";
      } else {
        this._data[fname] = mode === "all" || (mode === "required" && req) ? fname : "";
      }
    }
    if (this._schema[this._template].icon && !this._data.icon) this._data.icon = "(none)";
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (this._batchForm) this._batchForm.hass = hass;
    // First hass assignment: render an initial (placeholder) preview.
    if (!this._initialized) {
      this._initialized = true;
      this._run(false);
    }
    // Preview image follows the engine-written token (cache-buster).
    const token = hass.states[this._tokenEntity]?.state;
    if (token && token !== this._lastToken && !["", "unknown", "unavailable"].includes(token)) {
      this._lastToken = token;
      this._img.src = `/local/labels/preview.png?v=${token}`;
      this._img.style.display = "";
      this._placeholder.style.display = "none";
    }
    // Status line (last result), hidden when empty.
    const status = hass.states[this._statusEntity]?.state;
    const show = status && !["", "unknown", "unavailable"].includes(status);
    this._statusEl.style.display = show ? "" : "none";
    if (show) this._statusEl.textContent = status;
    // Loaded tape readout.
    const tape = hass.states[this._tapeSensor]?.state;
    this._tapeEl.textContent = tape && !["unknown", "unavailable"].includes(tape)
      ? `Loaded tape: ${tape}`
      : "Loaded tape: unavailable";
  }

  _leftSchema() {
    const t = this._schema[this._template];
    const schema = [
      {
        name: "_template",
        selector: {
          select: {
            options: this._templates.map((k) => ({
              value: k,
              label: `${k} (${this._schema[k].tape}mm tape)`,
            })),
          },
        },
      },
      {
        name: "_prefill",
        selector: {
          select: {
            options: [
              { value: "required", label: "Prefill required fields with field names" },
              { value: "all", label: "Prefill ALL fields with field names" },
              { value: "none", label: "No prefill" },
            ],
          },
        },
      },
    ];
    for (const [fname, req] of t.fields) {
      // Date fields render as custom rows (with quick buttons), not via ha-form.
      if (DATE_FIELDS.has(fname)) continue;
      schema.push({ name: fname, required: !!req, selector: { text: {} } });
    }
    return schema;
  }

  _batchSchema() {
    return [
      { name: "_batch_size", selector: { number: { min: 1, max: 50, mode: "box" } } },
      { name: "_gap_dots", selector: { number: { min: 0, max: 200, mode: "box" } } },
      { name: "_cut_every", selector: { number: { min: 0, max: 50, mode: "box" } } },
      { name: "_half_cut", selector: { boolean: {} } },
    ];
  }

  _labels = {
    _template: "Template",
    _prefill: "Field prefill",
    _batch_size: "Batch size (copies)",
    _gap_dots: "Gap between labels (dots)",
    _cut_every: "Full cut every N (0 = off)",
    _half_cut: "Half-cut between labels",
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
      h2 { font-size: 1.1rem; margin: 0 0 8px; font-weight: 600; }
      .buttons { display: flex; gap: 8px; margin-top: 12px; }
      .buttons ha-button { flex: 1; }
      .preview img { max-width: 100%; image-rendering: pixelated; background: #fff; }
      .meta { color: var(--secondary-text-color); font-size: 0.9em; margin-top: 8px; }
      .status { margin-top: 8px; font-weight: 500; }
      .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
                   gap: 4px; margin-top: 8px; }
      .icon-grid button { background: none; border: 2px solid transparent; border-radius: 6px;
                          padding: 4px; cursor: pointer; }
      .icon-grid button.selected { border-color: var(--primary-color); }
      .icon-grid button:hover { background: var(--secondary-background-color); }
      .icon-grid img { width: 28px; height: 28px; display: block; }
      .icon-grid button.none { color: var(--secondary-text-color); font-size: 0.75em;
                               min-height: 36px; }
      .date-row { display: grid; grid-template-columns: 1fr auto auto; gap: 4px;
                  align-items: end; margin-top: 8px; }
      .date-row label { grid-column: 1 / -1; font-size: 0.9em;
                        color: var(--primary-text-color); }
      .date-row input { width: 100%; box-sizing: border-box; padding: 6px 8px;
                        background: var(--card-background-color);
                        color: var(--primary-text-color);
                        border: none; border-bottom: 1px solid var(--secondary-text-color);
                        font: inherit; }
      .date-row button { background: var(--secondary-background-color); border: none;
                         border-radius: 6px; padding: 6px 8px; cursor: pointer;
                         color: var(--primary-color); font-size: 0.8em; white-space: nowrap; }
    `;
    const card = document.createElement("ha-card");
    card.innerHTML = `
      <div class="wrap">
        <div class="form-col">
          <h2>Label options</h2>
          <div class="form-host"></div>
          <div class="date-host"></div>
          <div class="icon-area"></div>
        </div>
        <div class="preview-col">
          <h2>Preview</h2>
          <div class="preview">
            <img style="display:none" alt="Label preview">
            <div class="placeholder meta">No preview yet — fill in the fields.</div>
          </div>
          <div class="status"></div>
          <div class="tape meta"></div>
          <h2 style="margin-top:12px">Batch</h2>
          <div class="batch-host"></div>
          <div class="buttons">
            <ha-button class="reset-btn">Reset</ha-button>
            <ha-button class="print-btn">Send to Printer</ha-button>
          </div>
        </div>
      </div>
    `;
    this._img = card.querySelector("img");
    this._placeholder = card.querySelector(".placeholder");
    this._statusEl = card.querySelector(".status");
    this._tapeEl = card.querySelector(".tape");
    card.querySelector(".print-btn").addEventListener("click", () => this._print());
    card.querySelector(".reset-btn").addEventListener("click", () => this._reset());
    this.replaceChildren(style, card);
    this._rebuildForm();
  }

  _makeForm(host, schema, data) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.schema = schema;
    form.data = data;
    form.computeLabel = this._computeLabel;
    host.replaceChildren(form);
    return form;
  }

  _rebuildForm() {
    this._form = this._makeForm(
      this.querySelector(".form-host"), this._leftSchema(), this._data,
    );
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const v = ev.detail.value;
      if (v._template !== this._template) {
        // New template: fresh defaults, fresh field set, immediate preview.
        this._template = v._template;
        this._data = this._defaults();
        this._applyPrefill();
        this._rebuildForm();
      } else if (v._prefill !== this._data._prefill) {
        // Prefill mode change: repopulate the field values accordingly.
        this._data = { ...v };
        this._applyPrefill();
        this._rebuildForm();
      } else {
        this._data = v;
      }
      this._debouncedPreview();
    });
    this._batchForm = this._makeForm(
      this.querySelector(".batch-host"), this._batchSchema(), this._data,
    );
    this._batchForm.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._data = { ...this._data, ...ev.detail.value };
      // Batch size changes the strip preview; gap/cut only matter at print time.
      if (ev.detail.value._batch_size !== undefined) this._debouncedPreview();
    });
    this._renderDateRows();
    this._renderIconPicker();
  }

  _renderDateRows() {
    const host = this.querySelector(".date-host");
    const rows = [];
    for (const [fname, req] of this._schema[this._template].fields) {
      if (!DATE_FIELDS.has(fname)) continue;
      const row = document.createElement("div");
      row.className = "date-row";
      const label = document.createElement("label");
      label.textContent = fname + (req ? " *" : "");
      const input = document.createElement("input");
      input.type = "text";
      input.value = this._data[fname] ?? "";
      input.placeholder = "YYYY-MM-DD";
      input.addEventListener("input", () => {
        this._data = { ...this._data, [fname]: input.value };
        this._debouncedPreview();
      });
      const week = document.createElement("button");
      week.textContent = "+1 wk";
      week.addEventListener("click", () => this._setDate(fname, plusWeek()));
      const month = document.createElement("button");
      month.textContent = "+1 mo";
      month.addEventListener("click", () => this._setDate(fname, plusMonth()));
      row.replaceChildren(label, input, week, month);
      rows.push(row);
    }
    host.replaceChildren(...rows);
  }

  _setDate(fname, value) {
    this._data = { ...this._data, [fname]: value };
    this._renderDateRows();
    this._debouncedPreview();
  }

  _renderIconPicker() {
    const area = this.querySelector(".icon-area");
    if (!this._schema[this._template].icon) {
      area.replaceChildren();
      delete this._data.icon;
      return;
    }
    const current = this._data.icon || "(none)";
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "meta";
    label.textContent = `Icon: ${current}`;
    const grid = document.createElement("div");
    grid.className = "icon-grid";
    const none = document.createElement("button");
    none.textContent = "none";
    none.className = current === "(none)" ? "none selected" : "none";
    none.addEventListener("click", () => this._pickIcon("(none)"));
    grid.appendChild(none);
    for (const name of this._icons) {
      const btn = document.createElement("button");
      btn.title = name;
      if (name === current) btn.classList.add("selected");
      const img = document.createElement("img");
      img.src = `${this._iconBase}/${name}.svg`;
      img.alt = name;
      btn.appendChild(img);
      btn.addEventListener("click", () => this._pickIcon(name));
      grid.appendChild(btn);
    }
    wrap.replaceChildren(label, grid);
    area.replaceChildren(wrap);
  }

  _pickIcon(name) {
    this._data = { ...this._data, icon: name };
    this._renderIconPicker();
    this._debouncedPreview();
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
      label_template: d._template,
      send,
      preview_path: "preview.png",
      extra_fields: fields,
      copies: d._batch_size ?? 1,
      gap_dots: d._gap_dots ?? 0,
      cut_every: d._cut_every ?? 0,
      half_cut: d._half_cut ?? true,
    };
  }

  async _run(send) {
    if (!this._hass) return;
    try {
      // The engine writes label_last_result + bumps the preview token; the
      // card picks both up via hass state. Service-level failures show here.
      await this._hass.callService("script", "print_label", this._payload(send));
    } catch (e) {
      this._statusEl.textContent = e.message || String(e);
      this._statusEl.style.display = "";
    }
  }

  _print() {
    if (window.confirm("Send this label to the printer?")) this._run(true);
  }

  _reset() {
    this._data = this._defaults();
    this._applyPrefill();
    this._rebuildForm();
    this._debouncedPreview();
  }

  getCardSize() {
    return 10;
  }
}

customElements.define("label-printer-card", LabelPrinterCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "label-printer-card",
  name: "Label Printer Card",
  description: "Dynamic form for the label printer service (helper-free).",
});
