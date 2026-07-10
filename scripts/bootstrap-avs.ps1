#!/usr/bin/env pwsh
# bootstrap-avs.ps1
# Configure Claude Code d'un nouveau poste AVS en une seule commande :
#   - Cle extraKnownMarketplaces -> github.com/avstechfr/claude-plugins
#   - Cle enabledPlugins -> avs-statusline + avs-mcp-agent-chat
#   - Cle statusLine pointant (chemin ABSOLU, jamais ~) vers un launcher
#     ~/.claude/avs-statusline-launcher.sh qui suit automatiquement la derniere
#     version du plugin en cache
#     (workaround tant que Anthropic ne supporte pas statusLine en plugin settings)
#
# Usage (depuis n'importe ou) :
#   irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/bootstrap-avs.ps1 | iex
#
# Ou en local :
#   pwsh -File scripts\bootstrap-avs.ps1

$ErrorActionPreference = 'Stop'

Write-Host "=== Bootstrap AVS Claude Code ===" -ForegroundColor Cyan
Write-Host ""

# --- 0. Repertoire ~/.claude ---
$ClaudeDir = Join-Path $HOME ".claude"
if (-not (Test-Path $ClaudeDir)) {
    Write-Host "[INFO] Creation $ClaudeDir"
    New-Item -ItemType Directory -Path $ClaudeDir | Out-Null
}

# --- 1. Backup settings.json existant ---
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$Settings = @{}
if (Test-Path $SettingsPath) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Backup = "$SettingsPath.bak-$Stamp"
    Copy-Item $SettingsPath $Backup
    Write-Host "[INFO] Backup -> $Backup"
    $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable
}

# --- 2. Merge extraKnownMarketplaces ---
if (-not $Settings.ContainsKey('extraKnownMarketplaces')) {
    $Settings['extraKnownMarketplaces'] = @{}
}
$Settings['extraKnownMarketplaces']['avs-plugins'] = @{
    source = @{
        source = 'github'
        repo   = 'avstechfr/claude-plugins'
    }
}

# --- 3. Merge enabledPlugins ---
if (-not $Settings.ContainsKey('enabledPlugins')) {
    $Settings['enabledPlugins'] = @{}
}
$Settings['enabledPlugins']['avs-statusline@avs-plugins'] = $true
$Settings['enabledPlugins']['avs-mcp-agent-chat@avs-plugins'] = $true
$Settings['enabledPlugins']['avs-mcp-kb@avs-plugins'] = $true

# --- 4. statusLine via launcher stable (workaround Anthropic) ---
# Deux pieges resolus ici :
#   1. Sous Windows, Claude Code lance la commande statusLine via cmd qui ne resout PAS ~
#      -> la commande echoue silencieusement et AUCUNE statusline ne s'affiche.
#      On ecrit donc un chemin ABSOLU dans settings.json.
#   2. Le chemin du cache contient le numero de version du plugin, qui casse a chaque release.
#      Le launcher resout la DERNIERE version en cache a chaque execution :
#      plus besoin de retoucher settings.json quand le plugin est mis a jour.
$LauncherPath = Join-Path $ClaudeDir "avs-statusline-launcher.sh"
$LauncherBash = @'
#!/bin/bash
# Launcher statusline AVS : delegue a la derniere version du plugin en cache.
# Genere par bootstrap-avs.ps1 — ne pas editer, relancer le bootstrap pour regenerer.
BASE="$HOME/.claude/plugins/cache/avs-plugins/avs-statusline"
LATEST=$(ls -1 "$BASE" 2>/dev/null | sort -V 2>/dev/null | tail -1)
[ -z "$LATEST" ] && LATEST=$(ls -1 "$BASE" 2>/dev/null | sort | tail -1)
if [ -n "$LATEST" ]; then
  exec bash "$BASE/$LATEST/bin/statusline-dispatch.sh"
fi
# Plugin pas encore telecharge (1er lancement) : ligne minimale
cat > /dev/null
printf 'AVS - plugin avs-statusline en cours d installation, relance Claude Code\n'
'@
[System.IO.File]::WriteAllText($LauncherPath, ($LauncherBash -replace "`r`n", "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
$LauncherAbs = $LauncherPath -replace '\\', '/'
$Settings['statusLine'] = @{
    type    = 'command'
    command = "bash `"$LauncherAbs`""
}

# --- 5. Ecriture ---
$Settings | ConvertTo-Json -Depth 10 | Out-File -FilePath $SettingsPath -Encoding UTF8
Write-Host "[OK] settings.json mis a jour" -ForegroundColor Green

# --- 6. Verifications dependances ---
Write-Host ""
Write-Host "=== Dependances ===" -ForegroundColor Cyan

$NodeOK = $false
try {
    $v = & node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Node.js $v" -ForegroundColor Green
        $NodeOK = $true
    }
} catch {}
if (-not $NodeOK) {
    Write-Host "[WARN] Node.js absent — installer https://nodejs.org pour que avs-mcp-agent-chat fonctionne" -ForegroundColor Yellow
}

$GitOK = $false
try {
    $v = & git --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] $v" -ForegroundColor Green
        $GitOK = $true
    }
} catch {}
if (-not $GitOK) {
    Write-Host "[ERR] Git absent — REQUIS pour la statusline + plugins" -ForegroundColor Red
}

$BashOK = $false
try {
    $null = & bash --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] bash dispo (Git Bash)" -ForegroundColor Green
        $BashOK = $true
    }
} catch {}
if (-not $BashOK) {
    Write-Host "[ERR] bash absent — REQUIS pour la statusline (installer Git for Windows qui inclut Git Bash)" -ForegroundColor Red
}

$PwshOK = $false
try {
    $v = & pwsh --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] $v" -ForegroundColor Green
        $PwshOK = $true
    }
} catch {}
if (-not $PwshOK) {
    Write-Host "[WARN] pwsh (PowerShell 7) absent — la statusline fallback sur powershell 5.1 (rendu emoji moins propre)" -ForegroundColor Yellow
}

# --- 7. Variables d'env pour le backend HTTP du chat ---
Write-Host ""
Write-Host "=== MCP agent-chat backend ===" -ForegroundColor Cyan
if ($env:AGENT_CHAT_BACKEND -eq 'http' -and $env:AGENT_CHAT_HTTP_KEY) {
    Write-Host "[OK] Backend HTTP active (AGENT_CHAT_BACKEND=http + AGENT_CHAT_HTTP_KEY)" -ForegroundColor Green
} else {
    Write-Host "[INFO] Backend par defaut = FileStore local (single-machine)." -ForegroundColor Yellow
    Write-Host "       Pour activer le backend HTTP cross-machine equipe AVS :"
    Write-Host "         setx AGENT_CHAT_BACKEND http"
    Write-Host "         setx AGENT_CHAT_HTTP_KEY <ta-cle-AVS_API_KEY>"
}

# --- 8. Final ---
Write-Host ""
Write-Host "=== Termine ===" -ForegroundColor Cyan
Write-Host "Relance Claude Code (exit puis claude) pour appliquer." -ForegroundColor Green
Write-Host "Au 1er lancement : prompt 'Trust marketplace avstechfr/claude-plugins?' -> Yes."
