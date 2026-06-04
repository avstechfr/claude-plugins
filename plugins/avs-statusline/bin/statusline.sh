#!/bin/bash
# AVS statusline (Mac / Linux variant)
# Reads Claude Code JSON from stdin, prints :
#   📁 <repo> · 🤖 <agent> · 🌿 <branch> · ✨ <model>

PAYLOAD="$(cat)"

# --- Model + ancre projet (jq if available, else grep fallback) ---
# On s'ancre sur workspace.project_dir (stable) plutot que cwd (derive quand on `cd` ailleurs).
REPO_NAME=""
if command -v jq >/dev/null 2>&1; then
  MODEL=$(printf '%s' "$PAYLOAD"  | jq -r '.model.display_name // "?"'                     2>/dev/null)
  ANCHOR=$(printf '%s' "$PAYLOAD" | jq -r '.workspace.project_dir // .cwd // ""'           2>/dev/null)
  REPO_NAME=$(printf '%s' "$PAYLOAD" | jq -r '.workspace.repo.name // ""'                  2>/dev/null)
else
  MODEL=$(printf '%s' "$PAYLOAD" | grep -oE '"display_name"\s*:\s*"[^"]*"' | head -1 | sed -E 's/.*"display_name"\s*:\s*"([^"]*)".*/\1/')
  ANCHOR=$(printf '%s' "$PAYLOAD" | grep -oE '"project_dir"\s*:\s*"[^"]*"' | head -1 | sed -E 's/.*"project_dir"\s*:\s*"([^"]*)".*/\1/')
  [ -z "$ANCHOR" ] && ANCHOR=$(printf '%s' "$PAYLOAD" | grep -oE '"cwd"\s*:\s*"[^"]*"' | head -1 | sed -E 's/.*"cwd"\s*:\s*"([^"]*)".*/\1/')
  REPO_NAME=$(printf '%s' "$PAYLOAD" | grep -oE '"repo"\s*:\s*\{[^}]*"name"\s*:\s*"[^"]*"' | head -1 | sed -E 's/.*"name"\s*:\s*"([^"]*)".*/\1/')
fi
[ -z "$MODEL" ]  && MODEL="?"
[ -z "$ANCHOR" ] && ANCHOR="$(pwd)"

# --- Git project name + branch + agent ---
PROJECT="—"
AGENT="—"
BRANCH="—"
if [ -n "$GIT_ROOT" ]; then
  PROJECT=$(basename "$GIT_ROOT")
  if [ -f "$GIT_ROOT/.claude/agent-name" ]; then
    AGENT=$(tr -d '\n\r' < "$GIT_ROOT/.claude/agent-name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  fi
  B=$(git -C "$ANCHOR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ -n "$B" ] && BRANCH="$B"
fi
# Fallback : nom de repo fourni par Claude Code si git indisponible
[ "$PROJECT" = "—" ] && [ -n "$REPO_NAME" ] && PROJECT="$REPO_NAME"

# --- Sujet AVS en cours (~/.claude/sujets/<repo-key>.txt) ---
# Cle = chemin du projet (gitRoot si dispo, sinon l'ancre) normalise [^A-Za-z0-9] -> _.
# Ecrit par l'agent Claude quand on ouvre/change de sujet. Fichier absent => rien d'affiche.
SUJET=""
KEY="${GIT_ROOT:-$ANCHOR}"
SAFE=$(printf '%s' "$KEY" | sed -E 's/[^A-Za-z0-9]/_/g')
SUJET_FILE="$HOME/.claude/sujets/$SAFE.txt"
if [ -f "$SUJET_FILE" ]; then
  SUJET=$(tr -d '\r' < "$SUJET_FILE" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' | head -1)
fi

if [ -n "$SUJET" ]; then
  printf "🎯 %s · 📁 %s · 🤖 %s · 🌿 %s · ✨ %s\n" "$SUJET" "$PROJECT" "$AGENT" "$BRANCH" "$MODEL"
else
  printf "📁 %s · 🤖 %s · 🌿 %s · ✨ %s\n" "$PROJECT" "$AGENT" "$BRANCH" "$MODEL"
fi
