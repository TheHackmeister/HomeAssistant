#!/bin/sh
# Save a base64-encoded PNG to www/labels/.
# Usage: save_label_preview.sh <base64_data> <filename>
mkdir -p /config/www/labels
printf '%s' "$1" | base64 -d > "/config/www/labels/$2"
