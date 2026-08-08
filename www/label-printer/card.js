// Label Printer card — helper-free dynamic form for the brother-ptouch-automation service.
//
// Holds all form state client-side (no input helpers), regenerates fields per
// selected template from the embedded schema (mirrors GET /templates), live
// previews on every change (debounced), and calls script.print_label directly.
// The preview image / status line / loaded-tape display are driven by HA state
// (preview token + last-result helpers written by script.print_label, and a
// REST sensor on /status) so they stay truthful even for non-card callers.

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

  _formSchema() {
    const t = this._schema[this._template];
    const schema = [
      {
        name: "_template",
        selector: {
          select: {
            options: this._templates.map((k) => ({
              value: k,
              label: `${k} — ${this._schema[k].tape}mm`,
            })),
          },
        },
      },
    ];
    for (const [fname, req] of t.fields) {
      schema.push({ name: fname, required: !!req, selector: { text: {} } });
    }
    if (t.icon) {
      schema.push({ name: "icon", selector: { select: { options: ["(none)", ...this._icons] } } });
    }
    schema.push(
      { name: "_batch_size", selector: { number: { min: 1, max: 50, mode: "box" } } },
      { name: "_gap_dots", selector: { number: { min: 0, max: 200, mode: "box" } } },
      { name: "_cut_every", selector: { number: { min: 0, max: 50, mode: "box" } } },
      { name: "_half_cut", selector: { boolean: {} } },
    );
    return schema;
  }

  _labels = {
    _template: "Template",
    _batch_size: "Batch size (copies)",
    _gap_dots: "Gap between labels (dots)",
    _cut_every: "Full cut every N (0 = off)",
    _half_cut: "Half-cut between labels",
    icon: "Icon",
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
      </div>
    `;
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
        // New template: fresh defaults, fresh field set, immediate preview.
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
    this._rebuildForm();
    this._debouncedPreview();
  }

  getCardSize() {
    return 8;
  }
}

customElements.define("label-printer-card", LabelPrinterCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "label-printer-card",
  name: "Label Printer Card",
  description: "Dynamic form for the label printer service (helper-free).",
});
