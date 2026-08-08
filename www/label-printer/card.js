// Label Printer card — helper-free dynamic form for the brother-ptouch-automation service.
//
// All form state is client-side. Fields regenerate per selected template from
// the embedded schema (mirrors GET /templates). Every change debounces into a
// live preview via script.print_label (send=false); the engine writes the
// preview token / last-result helpers and the card follows them via HA state.
//
// Date fields prefill to today (any prefill mode except "none") and get
// +1wk / +2wk / +1mo quick buttons. Template options show the template's
// DEFAULT tape — every template renders at any tape width (3.5/6/9/12/18/24).

const DATE_FIELDS = new Set([
  "purchased", "expires", "cooked", "frozen", "opened", "sow_by", "planted",
  "last_cal", "checked", "retain_until", "next_due", "charged", "best_by", "date",
]);

// Integer fields (name -> prefill default). Rendered as number inputs.
const INT_FIELDS = new Map([
  ["eat_within_days", 7],
  ["overlap_mm", 7],
]);

const isoDate = (d) => d.toISOString().slice(0, 10);
const today = () => isoDate(new Date());
const plusDays = (n) => isoDate(new Date(Date.now() + n * 86400000));
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
      } else if (INT_FIELDS.has(fname)) {
        // Ints prefill to a number, not the field-name string.
        this._data[fname] = mode === "none" ? "" : (mode === "all" || req) ? INT_FIELDS.get(fname) : "";
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
    // First hass assignment: render an initial (placeholder) preview and
    // subscribe to restore events from the Saved Groups view.
    if (!this._initialized) {
      this._initialized = true;
      this._run(false);
      hass.connection.subscribeEvents(
        (ev) => this._restore(ev.data),
        "label_printer_restore",
      );
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

  _formSchema() {
    const schema = [
      {
        name: "_prefill",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "required", label: "Prefill required fields with field names" },
              { value: "all", label: "Prefill ALL fields with field names" },
              { value: "none", label: "No prefill" },
            ],
          },
        },
      },
    ];
    for (const [fname, req] of this._schema[this._template].fields) {
      // Date fields render as custom rows (with quick buttons), not via ha-form.
      if (DATE_FIELDS.has(fname)) continue;
      if (INT_FIELDS.has(fname)) {
        schema.push({ name: fname, required: !!req, selector: { number: { min: 0, max: 9999, mode: "box" } } });
        continue;
      }
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
      .card-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .card-title ha-icon { color: var(--primary-color); }
      .card-title h1 { font-size: 1.4rem; margin: 0; font-weight: 500; }
      .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      @media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
      h2 { font-size: 1.1rem; margin: 0 0 8px; font-weight: 600; }
      .tpl-row label, .date-row label { display: block; font-size: 0.9em; margin-bottom: 2px; }
      .tpl-row select { width: 100%; padding: 8px; font: inherit;
                        background: var(--card-background-color);
                        color: var(--primary-text-color);
                        border: 1px solid var(--divider-color); border-radius: 6px; }
      .tpl-nav { display: flex; gap: 4px; margin: 4px 0 8px; }
      .tpl-nav button { flex: 1; background: var(--secondary-background-color); border: none;
                        border-radius: 6px; padding: 6px 8px; cursor: pointer;
                        color: var(--primary-color); }
      .tape-note { color: var(--secondary-text-color); font-size: 0.8em; margin-bottom: 8px; }
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
      .date-row { display: grid; grid-template-columns: 1fr repeat(4, auto); gap: 4px;
                  align-items: end; margin-top: 8px; }
      .date-row label { grid-column: 1 / -1; }
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
      <div class="card-title"><ha-icon icon="mdi:label-printer"></ha-icon><h1>Label Printer</h1></div>
      <div class="wrap">
        <div class="form-col">
          <div class="tpl-row">
            <label for="tpl">Template</label>
            <select id="tpl"></select>
            <div class="tpl-nav">
              <button class="tpl-prev">◀ Prev</button>
              <button class="tpl-next">Next ▶</button>
            </div>
            <div class="tape-note">Listed size is the template's default — all templates
              accept 3.5 / 6 / 9 / 12 / 18 / 24 mm tape.</div>
          </div>
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
            <ha-button class="save-btn">Save Group</ha-button>
            <ha-button class="print-btn">Send to Printer</ha-button>
          </div>
        </div>
      </div>
    `;
    this._img = card.querySelector("img");
    this._placeholder = card.querySelector(".placeholder");
    this._statusEl = card.querySelector(".status");
    this._tapeEl = card.querySelector(".tape");
    this._tplSelect = card.querySelector("#tpl");
    this._tplSelect.addEventListener("change", () => this._changeTemplate(this._tplSelect.value));
    card.querySelector(".tpl-prev").addEventListener("click", () => this._stepTemplate(-1));
    card.querySelector(".tpl-next").addEventListener("click", () => this._stepTemplate(1));
    card.querySelector(".print-btn").addEventListener("click", () => this._print());
    card.querySelector(".reset-btn").addEventListener("click", () => this._reset());
    card.querySelector(".save-btn").addEventListener("click", () => this._saveGroup());
    this.replaceChildren(style, card);
    this._rebuildForm();
  }

  _stepTemplate(delta) {
    const i = this._templates.indexOf(this._template);
    const next = (i + delta + this._templates.length) % this._templates.length;
    this._changeTemplate(this._templates[next]);
  }

  _changeTemplate(tpl) {
    if (tpl === this._template) return;
    // Template change only regenerates the template's own field values;
    // prefill mode, icon choice, and batch settings all carry over.
    const keep = {
      _prefill: this._data._prefill,
      icon: this._data.icon,
      _batch_size: this._data._batch_size,
      _gap_dots: this._data._gap_dots,
      _cut_every: this._data._cut_every,
      _half_cut: this._data._half_cut,
    };
    this._template = tpl;
    this._data = { ...this._defaults(), ...keep, _template: tpl };
    this._applyPrefill();
    // Icon choice carries over, and is remembered across non-icon templates.
    if (this._schema[tpl].icon) {
      this._data.icon = keep.icon || this._lastIcon || "(none)";
    } else {
      if (keep.icon && keep.icon !== "(none)") this._lastIcon = keep.icon;
      delete this._data.icon;
    }
    this._rebuildForm();
    this._debouncedPreview();
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
    // Template select (custom row above the form)
    this._tplSelect.replaceChildren(
      ...this._templates.map((k) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = `${k} (${this._schema[k].tape}mm default)`;
        opt.selected = k === this._template;
        return opt;
      }),
    );

    this._form = this._makeForm(
      this.querySelector(".form-host"), this._formSchema(), this._data,
    );
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const v = ev.detail.value;
      if (v._prefill !== this._data._prefill) {
        // Prefill mode change: repopulate the field values accordingly.
        this._data = { ...this._data, ...v };
        this._applyPrefill();
        this._rebuildForm();
      } else {
        this._data = { ...this._data, ...v };
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
      row.replaceChildren(label, input);
      for (const [text, fn] of [["Today", today], ["+1 wk", () => plusDays(7)], ["+2 wk", () => plusDays(14)], ["+1 mo", plusMonth]]) {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.addEventListener("click", () => this._setDate(fname, fn()));
        row.appendChild(btn);
      }
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
    if (name !== "(none)") this._lastIcon = name;
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

  _restore(data) {
    if (!data) return;
    let fields = {};
    let batch = {};
    try { fields = JSON.parse(data.fields_json || "{}"); } catch (e) { /* ignore */ }
    try { batch = JSON.parse(data.batch_json || "{}"); } catch (e) { /* ignore */ }
    if (data.template && this._schema[data.template]) this._template = data.template;
    this._data = { ...this._defaults(), _template: this._template, ...batch, ...fields };
    this._rebuildForm();
    this._debouncedPreview();
    // Prime the Saved Groups search with the group's stored keywords.
    if (data.search) {
      this._hass.callService("input_text", "set_value", {
        entity_id: "input_text.label_group_search",
        value: data.search,
      });
    }
  }

  async _saveGroup() {
    if (!this._hass) return;
    const name = window.prompt("Group name:");
    if (!name || !name.trim()) return;
    const search = window.prompt("Search keywords for auto-entities (optional):", "") ?? "";
    const d = this._data;
    const fields = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith("_") && v !== "" && v != null && v !== "(none)") fields[k] = v;
    }
    const entry = {
      name: name.trim(),
      search: search.trim(),
      template: d._template,
      fields,
      batch: {
        _batch_size: d._batch_size ?? 1,
        _gap_dots: d._gap_dots ?? 0,
        _cut_every: d._cut_every ?? 0,
        _half_cut: d._half_cut ?? true,
      },
      saved_at: new Date().toISOString(),
    };
    // Read-modify-write the JSON doc in www/labels/ (persistent across restarts).
    let doc = { groups: [] };
    try {
      const r = await fetch("/local/labels/print_groups.json", { cache: "no-store" });
      if (r.ok) doc = await r.json();
    } catch (e) { /* first save */ }
    doc.groups = (doc.groups || []).filter((g) => g.name !== entry.name);
    doc.groups.push(entry);
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(doc))));
    await this._hass.callService("shell_command", "save_label_groups", { b64 });
    await this._hass.callService("homeassistant", "update_entity", {
      entity_id: "sensor.label_print_groups",
    });
    this._statusEl.textContent = `Saved group "${entry.name}"`;
    this._statusEl.style.display = "";
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

// Companion list card for the Saved Groups view. auto-entities computes the
// (search-filtered) entity list and injects it via card_param: entities; this
// card renders one tap-to-restore row per label_group.* entity.
class LabelGroupList extends HTMLElement {
  setConfig(config) {
    this._entities = config.entities || [];
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _build() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card { padding: 8px 16px; }
      .row { display: flex; align-items: center; gap: 10px; padding: 10px 4px;
             cursor: pointer; border-bottom: 1px solid var(--divider-color); }
      .row:last-child { border-bottom: none; }
      .row:hover { background: var(--secondary-background-color); }
      .row ha-icon { color: var(--primary-color); }
      .name { font-weight: 500; }
      .sub { color: var(--secondary-text-color); font-size: 0.85em; }
      .empty { color: var(--secondary-text-color); padding: 12px 4px; }
    `;
    this._card = document.createElement("ha-card");
    this._list = document.createElement("div");
    this._card.appendChild(this._list);
    this.replaceChildren(style, this._card);
  }

  _render() {
    if (!this._hass || !this._list) return;
    const rows = [];
    for (const entry of this._entities) {
      const id = entry.entity || entry;
      const st = this._hass.states[id];
      if (!st) continue;
      const a = st.attributes || {};
      const row = document.createElement("div");
      row.className = "row";
      const icon = document.createElement("ha-icon");
      icon.icon = "mdi:label-outline";
      const text = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = st.state;
      const sub = document.createElement("div");
      sub.className = "sub";
      const bits = [a.template, a.search].filter(Boolean);
      if (a.batch && a.batch._batch_size > 1) bits.push(`×${a.batch._batch_size}`);
      sub.textContent = bits.join("  ·  ");
      text.replaceChildren(name, sub);
      row.replaceChildren(icon, text);
      row.addEventListener("click", () => {
        this._hass.callService("script", "label_restore_group", { entity_id: id });
      });
      rows.push(row);
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No saved groups match. Save one from the Create tab with Save Group.";
      rows.push(empty);
    }
    this._list.replaceChildren(...rows);
  }

  getCardSize() {
    return Math.max(1, this._entities.length);
  }
}

customElements.define("label-group-list", LabelGroupList);
window.customCards.push({
  type: "label-group-list",
  name: "Label Group List",
  description: "Saved label groups with tap-to-restore (fed by auto-entities).",
});
