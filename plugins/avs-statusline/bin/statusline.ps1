#!/usr/bin/env pwsh
# AVS statusline (Windows PowerShell variant)
# Reads Claude Code JSON from stdin, prints :
#   🎯 <sujet> · 📁 <repo> · 📂 <dossier courant> · 🤖 <agent> · 🌿 <branch> · ✨ <model>

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

# --- Ancre = repertoire du PROJET de la session (stable), pas le cwd courant ---
# Le cwd derive des qu'on `cd` ailleurs (ex: commit dans un autre repo) ; workspace.project_dir
# reste fixe sur le projet ouvert. On s'ancre dessus pour que la statusline reste coherente.
$anchor = $null
if ($input_data -and $input_data.workspace -and $input_data.workspace.project_dir) {
    $anchor = $input_data.workspace.project_dir
} elseif ($input_data -and $input_data.cwd) {
    $anchor = $input_data.cwd
} else {
    $anchor = (Get-Location).Path
}

# --- Git project name (repo root basename) ---
$projectName = "—"
$gitRoot = $null
try {
    $gitRoot = & git -C $anchor rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitRoot) {
        $projectName = Split-Path -Leaf ($gitRoot.Trim())
    }
} catch {}
# Fallback : nom de repo fourni par Claude Code si git indisponible
if ($projectName -eq "—" -and $input_data -and $input_data.workspace -and $input_data.workspace.repo -and $input_data.workspace.repo.name) {
    $projectName = $input_data.workspace.repo.name
}

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
    $branch = & git -C $anchor rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $branch) { $branch = "—" } else { $branch = $branch.Trim() }
} catch {}

# --- Repertoire courant reel (peut differer de l'ancre projet si on a `cd` ailleurs) ---
# Affiche par rapport a la racine du repo git (".", ou chemin relatif type "site-web/app").
# Si hors repo git, affiche juste le nom du dossier courant.
$cwd = if ($input_data -and $input_data.workspace -and $input_data.workspace.current_dir) {
    $input_data.workspace.current_dir
} elseif ($input_data -and $input_data.cwd) {
    $input_data.cwd
} else {
    (Get-Location).Path
}

$relDir = "."
try {
    if ($gitRoot) {
        $rootFull = (Resolve-Path $gitRoot.Trim()).Path.TrimEnd('\')
        $cwdFull = (Resolve-Path $cwd).Path.TrimEnd('\')
        if ($cwdFull -eq $rootFull) {
            $relDir = "."
        } elseif ($cwdFull.StartsWith($rootFull + '\')) {
            $relDir = ($cwdFull.Substring($rootFull.Length + 1)) -replace '\\', '/'
        } else {
            $relDir = Split-Path -Leaf $cwdFull
        }
    } else {
        $relDir = Split-Path -Leaf $cwd
    }
} catch {}

# --- Sujet AVS en cours ---
# Priorite 1 : ~/.claude/sujets/session-<session_id>.txt (par SESSION — plusieurs agents
#              en parallele sur le meme repo ont chacun leur sujet).
# Priorite 2 : ~/.claude/sujets/<repo-key>.txt (par repo). Cle = chemin du projet
#              (gitRoot si dispo, sinon l'ancre) normalise [^A-Za-z0-9] -> _.
# Ecrit par l'agent Claude quand on ouvre/change de sujet. Absent => rien d'affiche.
$sujet = $null
try {
    if ($input_data -and $input_data.session_id) {
        $sessionFile = Join-Path $env:USERPROFILE ".claude\sujets\session-$($input_data.session_id).txt"
        if (Test-Path $sessionFile) {
            $sujet = (Get-Content $sessionFile -Raw -Encoding UTF8).Trim()
            if ([string]::IsNullOrWhiteSpace($sujet)) { $sujet = $null }
        }
    }
    if (-not $sujet) {
        $key = if ($gitRoot) { $gitRoot.Trim() } else { $anchor }
        $safe = ($key -replace '[^A-Za-z0-9]', '_')
        $sujetFile = Join-Path $env:USERPROFILE ".claude\sujets\$safe.txt"
        if (Test-Path $sujetFile) {
            $sujet = (Get-Content $sujetFile -Raw -Encoding UTF8).Trim()
            if ([string]::IsNullOrWhiteSpace($sujet)) { $sujet = $null }
        }
    }
} catch {}

$line = "📁 $projectName · 📂 $relDir · 🤖 $agentName · 🌿 $branch · ✨ $model"
if ($sujet) { $line = "🎯 $sujet · " + $line }
Write-Host $line
