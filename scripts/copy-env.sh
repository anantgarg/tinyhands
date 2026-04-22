#!/usr/bin/env bash
# copy-env.sh — bootstrap a worktree's .env from the canonical one in the
# main tree. Run from any worktree root:
#
#   bash /Users/anantgarg/Local/tinyhands/scripts/copy-env.sh
#
# The canonical .env lives at /Users/anantgarg/Local/tinyhands/.env and is
# gitignored. If it doesn't exist, edit it there first (never check in).
set -euo pipefail
SOURCE="/Users/anantgarg/Local/tinyhands/.env"
if [[ ! -f "$SOURCE" ]]; then
  echo "error: canonical env at $SOURCE does not exist" >&2
  exit 1
fi
DEST="$(pwd)/.env"
if [[ -f "$DEST" ]]; then
  echo "warn: $DEST already exists — backing up to .env.bak"
  cp "$DEST" "$DEST.bak"
fi
cp "$SOURCE" "$DEST"
chmod 600 "$DEST"
echo "copied $SOURCE → $DEST"
