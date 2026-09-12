#!/bin/bash
# Shim de compatibilite : les postes bootstrappes avant la v2.0.0 pointent encore ici.
# Toute la logique est dans statusline.mjs (un seul script, tous OS) — voir README.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${SCRIPT_DIR}/statusline.mjs"
