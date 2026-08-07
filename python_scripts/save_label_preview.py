"""
Save a base64-encoded label preview PNG into www/labels/.

Called by script.print_label (dry-run branch) with:
  b64:      base64 PNG data from the label API's /render response
  filename: target filename inside www/labels/ (default preview.png)

This replaces the old shell_command.save_label_preview. That version could
never work: a templated shell_command runs WITHOUT a shell, so the pipe,
redirect, and && were passed to mkdir as literal arguments (rc=1).

python_script forbids `import`, so base64 is decoded manually below.
hass.config.path() locates the real config dir (no hardcoded /config).

NOTE: www/labels/ must exist (it is tracked in git). python_script cannot
create directories without `import os`.
"""

B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def b64decode(text):
    text = "".join(c for c in text if c in B64_CHARS)
    out = bytearray()
    for i in range(0, len(text), 4):
        chunk = text[i : i + 4]
        acc = 0
        for c in chunk:
            acc = (acc << 6) | B64_CHARS.index(c)
        acc <<= 6 * (4 - len(chunk))
        for j in range(max(0, len(chunk) - 1)):
            out.append((acc >> (8 * (2 - j))) & 0xFF)
    return bytes(out)


b64 = data.get("b64") or ""
filename = data.get("filename") or "preview.png"

# Basic traversal guard: bare filename only, no path components.
filename = filename.replace("\\", "/").split("/")[-1] or "preview.png"

if not b64:
    logger.error("save_label_preview: no b64 data provided")
else:
    png = b64decode(b64)
    path = hass.config.path("www", "labels", filename)
    with open(path, "wb") as fh:
        fh.write(png)
    logger.info("save_label_preview: wrote %s (%d bytes)", path, len(png))
