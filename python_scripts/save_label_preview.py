import base64, os

b64 = data.get("b64", "")
filename = data.get("filename", "preview.png")

if b64:
    path = hass.config.path("www", "labels", filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
