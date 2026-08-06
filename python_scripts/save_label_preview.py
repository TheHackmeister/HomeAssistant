import base64

b64 = data.get("b64", "")
filename = data.get("filename", "preview.png")

if not b64:
    return

path = hass.config.path("www", "labels", filename)
import os
os.makedirs(os.path.dirname(path), exist_ok=True)

with open(path, "wb") as f:
    f.write(base64.b64decode(b64))
