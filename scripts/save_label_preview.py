#!/usr/bin/env python3
"""Save a label preview PNG from the brother-ptouch-automation service.

Called by shell_command.save_label_preview with arguments:
  sys.argv[1] = label_template (e.g. "kitchen/spice")
  sys.argv[2] = tape_mm (e.g. "12")
  sys.argv[3] = fields JSON string (e.g. '{"name": "Paprika"}')
  sys.argv[4] = output filename (e.g. "preview.png")
"""

import json
import ssl
import sys
import urllib.request
import urllib.error


def main() -> int:
    if len(sys.argv) != 5:
        print(f"Usage: {sys.argv[0]} <template> <tape_mm> <fields_json> <filename>", file=sys.stderr)
        return 1

    label_template, tape_mm, fields_json, filename = sys.argv[1:5]

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    payload = json.dumps({
        "template": label_template,
        "tape_mm": int(tape_mm),
        "fields": json.loads(fields_json),
    }).encode()

    req = urllib.request.Request(
        "https://brother-ptouch-automation.spencerslab.com/render",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            data = resp.read()
    except urllib.error.URLError as e:
        print(f"Error fetching render: {e}", file=sys.stderr)
        return 1

    out_path = f"/config/www/labels/{filename}"
    with open(out_path, "wb") as f:
        f.write(data)

    print(f"Saved {len(data)} bytes to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
