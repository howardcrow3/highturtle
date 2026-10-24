#!/usr/bin/env bash
# Upload an app file so people can request it from turtlebox.studio.
#   bash infra/upload-app.sh <app-slug> <path-to-file> "App title"
# The slug matches the app's "slug" in turtlebox/apps.json. The newest file under a slug is the one served.
# Needs AWS credentials that can write to the turtlebox-downloads bucket (your own login is fine).
set -euo pipefail
[ $# -eq 3 ] || { echo 'usage: upload-app.sh <app-slug> <file> "App title"'; exit 1; }
SLUG=$1; FILE=$2; TITLE=$3
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,60}$ ]] || { echo "slug must be lowercase letters, numbers and hyphens"; exit 1; }
aws s3 cp "$FILE" "s3://turtlebox-downloads/$SLUG/$(basename "$FILE")" --region us-east-2 --metadata "title=$TITLE"
echo "Uploaded. In turtlebox/apps.json set \"download\": true on the $SLUG app, run python3 turtlebox/build.py, and push."
