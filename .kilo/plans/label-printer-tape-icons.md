# Label Printer — Tape Status Sync + Icon Display (implementation ready)

Scope agreed with user: **tape + icons only** (batch deferred). File edits were blocked by session
permissions; everything below is ready to apply verbatim.

## Research summary (verified against source + live API)

- Tape status: `NetworkTransport.query_status()` → SNMP (`transport/snmp.py`) parses media width
  from `prtInputMediaName` (e.g. `"12mm(0.47\")"`); 3.5mm tape reported as sentinel `4`.
  Used today only as the `/print` pre-check (`_verify_tape` → 409). No HTTP endpoint exposes it.
- Icons: 89 Lucide SVGs bundled at `label_printer/icons/lucide/` — same 89 names as the HA
  `input_select.label_icon` options. `IconRegistry.find(name)` resolves names; `IconNotFoundError`
  on misses. Serving raw SVG needs no cairosvg.
- Batch: `encode_batch(images, tape, options)` exists in `engine/raster.py` (hardware-tested
  half-cut chain jobs). NOT exposed in `service.py`. Deferred.

## 1. Server changes (`/home/coder/brother-ptouch-automation`)

### `src/label_printer/service.py`

Imports — add `FileResponse` to the fastapi.responses import, and add:

```python
from label_printer.engine.icons import IconNotFoundError
from label_printer.engine.icons import registry as _icon_registry
from label_printer.transport.base import StatusUnavailable
```

New endpoints (insert before `@app.post("/render")`):

```python
@app.get("/status")
def printer_status(authorization: str | None = Header(default=None)) -> Response:
    """Report the physically loaded tape width and any printer error state.

    Uses the same SNMP status path as the /print pre-check. Returns
    ``ok: false`` with a warning when the printer can't report status (e.g.
    SNMP disabled) so callers can fall back gracefully instead of failing.
    ``tape_mm`` is the real-world width — the printer reports 3.5mm tape as
    the protocol sentinel 4, which we map back here.
    """
    _require_token(authorization)
    host = _resolve_printer_host()
    transport = NetworkTransport(host)
    try:
        status = transport.query_status()
    except StatusUnavailable as e:
        return Response(
            json.dumps({"ok": False, "host": host, "warning": str(e)}),
            media_type="application/json",
        )
    except Exception as e:
        raise HTTPException(502, f"could not query printer status: {e}") from e
    return Response(
        json.dumps({
            "ok": True,
            "host": host,
            "has_media": status.has_media,
            "tape_mm": 3.5 if status.media_width_mm == 4 else status.media_width_mm,
            "errors": status.describe_errors(),
        }),
        media_type="application/json",
    )


@app.get("/icons/{name}.svg")
def icon_svg(name: str, authorization: str | None = Header(default=None)) -> Response:
    """Serve a bundled icon SVG by name (e.g. ``/icons/wifi.svg``).

    Raw file serve — no rasterization, so this works without the optional
    cairosvg dependency. Browsers render the SVG directly; the label engine
    rasterizes its own copy at print time.
    """
    _require_token(authorization)
    if "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(400, "invalid icon name")
    try:
        path = _icon_registry().find(name)
    except IconNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    return FileResponse(
        path,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )
```

### Tests to append to `tests/test_service.py` (follow existing FakeTransport pattern)

```python
def test_status_happy_path(client, monkeypatch):
    class FakeTransport:
        def __init__(self, host): self.host = host
        def query_status(self): return parse_status(build_mock_status(media_width_mm=12))
    monkeypatch.setenv("LABEL_PRINTER_HOST", "192.0.2.1")
    monkeypatch.setattr("label_printer.service.NetworkTransport", FakeTransport)
    r = client.get("/status")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["tape_mm"] == 12 and body["errors"] == []


def test_status_maps_3_5mm_sentinel(client, monkeypatch):
    class FakeTransport:
        def __init__(self, host): self.host = host
        def query_status(self): return parse_status(build_mock_status(media_width_mm=4))
    monkeypatch.setenv("LABEL_PRINTER_HOST", "192.0.2.1")
    monkeypatch.setattr("label_printer.service.NetworkTransport", FakeTransport)
    assert client.get("/status").json()["tape_mm"] == 3.5


def test_status_snmp_unavailable_returns_warning(client, monkeypatch):
    class FakeTransport:
        def __init__(self, host): self.host = host
        def query_status(self): raise StatusUnavailable("SNMP disabled")
    monkeypatch.setenv("LABEL_PRINTER_HOST", "192.0.2.1")
    monkeypatch.setattr("label_printer.service.NetworkTransport", FakeTransport)
    body = client.get("/status").json()
    assert body["ok"] is False and "warning" in body


def test_status_without_host_returns_503(client, monkeypatch):
    monkeypatch.delenv("LABEL_PRINTER_HOST", raising=False)
    monkeypatch.setattr("label_printer.service.state_mod.resolve_printer_host", lambda: None)
    assert client.get("/status").status_code == 503


def test_status_reports_printer_errors(client, monkeypatch):
    from label_printer.constants import ErrorInformation2
    class FakeTransport:
        def __init__(self, host): self.host = host
        def query_status(self):
            return parse_status(build_mock_status(error_info_2=ErrorInformation2.COVER_OPEN))
    monkeypatch.setenv("LABEL_PRINTER_HOST", "192.0.2.1")
    monkeypatch.setattr("label_printer.service.NetworkTransport", FakeTransport)
    assert "cover open" in client.get("/status").json()["errors"]


def test_icon_served(client):
    r = client.get("/icons/wifi.svg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/svg+xml"
    assert b"<svg" in r.content


def test_icon_unknown_404(client):
    assert client.get("/icons/definitely-not-an-icon.svg").status_code == 404


def test_icon_traversal_rejected(client):
    assert client.get("/icons/..svg").status_code == 400
```

Run: `cd /home/coder/brother-ptouch-automation && .venv/bin/python -m pytest tests/test_service.py -q`
(AGENTS.md: renderer stays pure; these endpoints touch no rendering paths.)

## 2. HA config changes (this worktree)

### `configuration.yaml` — add under `rest_command:`

```yaml
  label_printer_status:
    url: https://brother-ptouch-automation.spencerslab.com/status
    method: get
```

### `packages/label_printer.yaml`

a. Tape select — add 6 and 9 so any physically loaded width is settable:

```yaml
  label_tape_mm:
    options: ['3.5', '6', '9', '12', '18', '24']
```

b. `label_preview_from_helpers` — insert BEFORE the validation `if`, after the `variables` step:

```yaml
      # Sync the tape selector to what's physically loaded before rendering,
      # so the preview (and any later print) targets the real tape. A failed
      # status query never blocks a preview.
      - action: rest_command.label_printer_status
        response_variable: printer_status
        continue_on_error: true
      - if: "{{ printer_status is defined and (printer_status.content | default({}, true)) is mapping and printer_status.content.get('ok') }}"
        then:
          - action: input_select.select_option
            target:
              entity_id: input_select.label_tape_mm
            data:
              option: "{{ printer_status.content.tape_mm }}"
```

(`tape_mm` renders as `12` or `3.5`; matches the select options exactly.)

### `dashboards/label-printer.yaml`

a. Selected-icon preview — add to section 1 after the config-template-card:

```yaml
          - type: markdown
            content: >
              {% set icon = states('input_select.label_icon') %}
              {% if icon not in ['(none)', '', 'unknown', 'unavailable'] %}
              Selected icon: <img src="https://brother-ptouch-automation.spencerslab.com/icons/{{ icon }}.svg" width="48" alt="{{ icon }}">
              {% else %}
              No icon selected.
              {% endif %}
```

b. Icon picker grid — new third section (picture cards tap to set the select; icon list embedded,
same 89 names as the select options):

```yaml
      - type: grid
        cards:
          - type: heading
            heading: Icon picker
            icon: mdi:emoticon-outline
          - type: custom:config-template-card
            entities:
              - input_select.label_icon
            card:
              type: grid
              columns: 8
              square: true
              cards: >-
                ${ ["antenna","apple", ...all 89 names..., "zap"].map(n => ({
                  type: 'picture',
                  image: 'https://brother-ptouch-automation.spencerslab.com/icons/' + n + '.svg',
                  tap_action: {
                    action: 'perform-action',
                    perform_action: 'input_select.select_option',
                    target: { entity_id: 'input_select.label_icon' },
                    data: { option: n },
                  },
                })) }
```

## Validation checklist when applying

1. Server: pytest test_service.py green; restart the service container; `curl /status` and
   `curl -o /dev/null -w '%{http_code}' /icons/wifi.svg` both 200.
2. HA: YAML lint; reload rest_command + packages + scripts.
3. Preview with a template whose default tape ≠ loaded tape → tape select flips to the loaded
   width before the render, preview renders at that width.
4. Dashboard: icon preview image appears when an icon is selected; picker grid sets the select
   on tap.
5. If SVGs render too small in picture cards (24px intrinsic size), add a `?size=128` PNG route
   server-side via cairosvg later.
