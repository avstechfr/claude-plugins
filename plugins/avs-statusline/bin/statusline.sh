#!/bin/bash
# AVS statusline (Mac / Linux variant)
# Reads Claude Code JSON from stdin, prints :
#   📁 <repo> · 🤖 <agent> · 🌿 <branch> · ✨ <model>

PAYLOAD="$(cat)"

# --- Model (jq if available, else grep fallback) ---
if command -v jq >/dev/null 2>&1; then
  MODEL=$(printf '%s' "$PAYLOAD" | jq -r '.model.display_name // "?"' 2>/dev/null)
  CWD=$(printf '%s' "$PAYLOAD"   | jq -r '.cwd // ""'                2>/dev/null)
else
  MODEL=$(printf '%s' "$PAYLOAD" | grep -oE '"display_name"\s*:\s*"[^"]*"' | head -1 | sed -E 's/.*"display_name"\s*:\s*"([^"]*)".*/\1/')
  CWD=$(printf '%s'   "$PAYLOAD" | grep -oE '"cwd"\s*:\s*"[^"]*"'          | head -1 | sed -E 's/.*"cwd"\s*:\s*"([^"]*)".*/\1/')
fi
[ -z "$MODEL" ] && MODEL="?"
[ -z "$CWD" ]   && CWD="$(pwd)"

# --- Git project name + branch + agent ---
PROJECT="—"
AGENT="—"
BRANCH="—"
GIT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
if [ -n "$GIT_ROOT" ]; then
  PROJECT=$(basename "$GIT_ROOT")
  if [ -f "$GIT_ROOT/.claude/agent-name" ]; then
    AGENT=$(tr -d '\n\r' < "$GIT_ROOT/.claude/agent-name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  fi
  B=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ -n "$B" ] && BRANCH="$B"
fi

printf "📁 %s · 🤖 %s · 🌿 %s · ✨ %s\n" "$PROJECT" "$AGENT" "$BRANCH" "$MODEL"
