import base64, os, sys

b64 = sys.argv[1]
filename = sys.argv[2]

path = os.path.join("/config/www/labels", filename)
os.makedirs(os.path.dirname(path), exist_ok=True)

with open(path, "wb") as f:
    f.write(base64.b64decode(b64))
