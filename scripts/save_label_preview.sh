#!/bin/sh
set -eu
DIR="${LABEL_PREVIEW_DIR:-/config/www/labels}"
mkdir -p "$DIR"
printf '%s' "$1" | base64 -d > "$DIR/$(basename "$2")"
