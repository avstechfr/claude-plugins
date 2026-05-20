#!/bin/bash
# Dispatcher cross-platform pour la statusline AVS
# - Windows (Git Bash, MSYS, Cygwin) : delegue a statusline.ps1 (PowerShell 7 si dispo, sinon Windows PowerShell)
# - macOS / Linux : execute statusline.sh nativement

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Capture le stdin (JSON Claude Code) une seule fois pour le re-injecter
PAYLOAD="$(cat)"

case "$OSTYPE" in
  msys*|cygwin*|win32*)
    # Windows : prefere pwsh (PowerShell 7), fallback powershell.exe
    if command -v pwsh >/dev/null 2>&1; then
      printf '%s' "$PAYLOAD" | pwsh -NoProfile -NonInteractive -File "${SCRIPT_DIR}/statusline.ps1"
    else
      printf '%s' "$PAYLOAD" | powershell -NoProfile -NonInteractive -File "${SCRIPT_DIR}/statusline.ps1"
    fi
    ;;
  *)
    # macOS / Linux
    printf '%s' "$PAYLOAD" | bash "${SCRIPT_DIR}/statusline.sh"
    ;;
esac
