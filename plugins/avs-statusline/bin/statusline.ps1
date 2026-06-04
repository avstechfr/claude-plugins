#!/usr/bin/env pwsh
# AVS statusline (Windows PowerShell variant)
# Reads Claude Code JSON from stdin, prints :
#   📁 <repo> · 🤖 <agent> · 🌿 <branch> · ✨ <model>

# Force UTF-8 output so emoji glyphs survive the pipe to Claude Code
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$input_data = $null
try {
    $raw = [Console]::In.ReadToEnd()
    $input_data = $raw | ConvertFrom-Json
} catch {
    $input_data = $null
}

# --- Model ---
$model = if ($input_data -and $input_data.model -and $input_data.model.display_name) {
    $input_data.model.display_name
} else { "?" }

# --- CWD from JSON (most reliable) ---
$cwd = if ($input_data -and $input_data.cwd) { $input_data.cwd } else { (Get-Location).Path }

# --- Git project name (repo root basename) ---
$projectName = "—"
$gitRoot = $null
try {
    $gitRoot = & git -C $cwd rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitRoot) {
        $projectName = Split-Path -Leaf ($gitRoot.Trim())
    }
} catch {}

# --- Agent name (.claude/agent-name at repo root) ---
$agentName = "—"
try {
    if ($gitRoot) {
        $agentFile = Join-Path $gitRoot.Trim() ".claude\agent-name"
        if (Test-Path $agentFile) {
            $agentName = (Get-Content $agentFile -Raw).Trim()
        }
    }
} catch {}

# --- Git branch ---
$branch = "—"
try {
    $branch = & git -C $cwd rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $branch) { $branch = "—" } else { $branch = $branch.Trim() }
} catch {}

# --- Sujet AVS en cours (~/.claude/sujets/<repo-key>.txt) ---
# Ecrit par l'agent Claude quand on ouvre/change de sujet ; cle = chemin du repo
# normalise ([^A-Za-z0-9] -> _). Fichier absent => rien d'affiche.
$sujet = $null
try {
    $key = if ($gitRoot) { $gitRoot.Trim() } else { $cwd }
    $safe = ($key -replace '[^A-Za-z0-9]', '_')
    $sujetFile = Join-Path $env:USERPROFILE ".claude\sujets\$safe.txt"
    if (Test-Path $sujetFile) {
        $sujet = (Get-Content $sujetFile -Raw -Encoding UTF8).Trim()
        if ([string]::IsNullOrWhiteSpace($sujet)) { $sujet = $null }
    }
} catch {}

$line = "📁 $projectName · 🤖 $agentName · 🌿 $branch · ✨ $model"
if ($sujet) { $line = "🎯 $sujet · " + $line }
Write-Host $line
