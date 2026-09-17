#!/usr/bin/env pwsh
# bootstrap-avs.ps1
# Configure Claude Code d'un poste AVS en une seule commande :
#   - Cle API personnelle ecrite dans ~/.avs/api_key (lue par TOUS les plugins AVS)
#   - Cle extraKnownMarketplaces -> github.com/avstechfr/claude-plugins
#   - Cle enabledPlugins -> TOUS les plugins du marketplace (liste lue en direct,
#     donc un plugin ajoute plus tard est active en relancant simplement ce script)
#   - Cle statusLine pointant (chemin ABSOLU, jamais ~) vers un launcher
#     ~/.claude/avs-statusline-launcher.mjs qui suit la derniere version en cache
#     (workaround tant que Anthropic ne supporte pas statusLine en plugin settings)
#
# Compatible Windows PowerShell 5.1 (celui livre avec Windows) ET PowerShell 7.
# Jusqu'au 17/09/2026 le script utilisait `ConvertFrom-Json -AsHashtable` (PS 7
# seulement) : sur un poste standard il plantait des l'etape 1, et seuls les plugins
# installes a la main fonctionnaient.
#
# Idempotent : relancer ne casse rien et ne redemande pas la cle si elle est valide.
#
# Usage (depuis n'importe ou, pas besoin de compte GitHub) :
#   irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/bootstrap-avs.ps1 | iex

$ErrorActionPreference = 'Stop'
$Utf8SansBom = New-Object System.Text.UTF8Encoding($false)

Write-Host "=== Bootstrap AVS Claude Code ===" -ForegroundColor Cyan
Write-Host ""

# --- 0. Repertoires ---
$ClaudeDir = Join-Path $HOME ".claude"
$AvsDir = Join-Path $HOME ".avs"
foreach ($d in @($ClaudeDir, $AvsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# --- 1. Cle API personnelle -> ~/.avs/api_key ---
# Un fichier plutot qu'une variable du profil PowerShell : Claude Code lance depuis l'app
# de bureau, VS Code ou un autre terminal n'herite pas du profil. KB, chat, verrous et
# statusline lisent tous ce fichier en dernier recours.
function Test-CleAvs($cle) {
    if (-not $cle) { return $null }
    try {
        return Invoke-RestMethod -Uri 'https://intra.avstech.fr/api/external/onboarding' `
            -Headers @{ 'X-API-Key' = $cle } -TimeoutSec 20
    } catch { return $null }
}

$CleFichier = Join-Path $AvsDir "api_key"
$cle = $null
if (Test-Path $CleFichier) { $cle = ([System.IO.File]::ReadAllText($CleFichier)).Trim([char]0xFEFF, ' ', "`r", "`n", "`t") }
$source = 'fichier ~/.avs/api_key'
if (-not $cle -and $env:AVS_API_KEY) { $cle = $env:AVS_API_KEY.Trim(); $source = 'variable AVS_API_KEY' }
$ancien = Join-Path $HOME "AVS\secrets\api_key.txt"   # emplacement de setup-dev.ps1
if (-not $cle -and (Test-Path $ancien)) { $cle = ([System.IO.File]::ReadAllText($ancien)).Trim([char]0xFEFF, ' ', "`r", "`n", "`t"); $source = '~/AVS/secrets' }

$profil = Test-CleAvs $cle
while (-not $profil) {
    if ($cle) { Write-Host "[WARN] Cle trouvee ($source) mais refusee par l'intranet." -ForegroundColor Yellow }
    Write-Host "Ta cle API personnelle est sur https://intra.avstech.fr/api-keys (la tienne, pas celle d'un collegue)." -ForegroundColor Gray
    $cle = (Read-Host "Colle ta cle API (avs_...), ou Entree pour passer").Trim()
    if (-not $cle) { break }
    $source = 'saisie'
    $profil = Test-CleAvs $cle
}
if ($profil) {
    [System.IO.File]::WriteAllText($CleFichier, $cle, $Utf8SansBom)
    try {
        # Fichier lisible par l'utilisateur courant seulement
        $acl = Get-Acl $CleFichier
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, 'FullControl', 'Allow')))
        Set-Acl $CleFichier $acl
    } catch {}
    $qui = if ($profil.agent.name) { $profil.agent.name } elseif ($profil.user.name) { $profil.user.name } else { 'compte reconnu' }
    Write-Host "[OK] Cle API valide ($qui) -> ~/.avs/api_key" -ForegroundColor Green
} else {
    Write-Host "[WARN] Pas de cle API : base de connaissances, chat et verrous resteront inactifs." -ForegroundColor Yellow
    Write-Host "       Relance ce script quand tu l'auras." -ForegroundColor Yellow
}

# --- 2. Lecture settings.json existant (sans -AsHashtable : PS 5.1) ---
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$Settings = New-Object PSObject
if (Test-Path $SettingsPath) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $SettingsPath "$SettingsPath.bak-$Stamp"
    Write-Host "[INFO] Backup -> $SettingsPath.bak-$Stamp"
    $brut = [System.IO.File]::ReadAllText($SettingsPath).Trim([char]0xFEFF)
    if ($brut.Trim()) { $Settings = $brut | ConvertFrom-Json }
}
function Set-Prop($obj, $nom, $valeur) {
    $obj | Add-Member -NotePropertyName $nom -NotePropertyValue $valeur -Force
}
function Get-OuCree($obj, $nom) {
    if (-not $obj.PSObject.Properties[$nom] -or $null -eq $obj.$nom) { Set-Prop $obj $nom (New-Object PSObject) }
    return $obj.$nom
}

# --- 3. Marketplace ---
Set-Prop (Get-OuCree $Settings 'extraKnownMarketplaces') 'avs-plugins' ([pscustomobject]@{
    source = [pscustomobject]@{ source = 'github'; repo = 'avstechfr/claude-plugins' }
})

# --- 4. Activation de TOUS les plugins du marketplace ---
# Liste lue en direct sur GitHub : un plugin ajoute au depot est active au prochain
# lancement de ce script, sans avoir a modifier le script lui-meme.
$plugins = @('avs-statusline', 'avs-mcp-agent-chat', 'avs-mcp-kb', 'avs-logics-depannage', 'avs-locks')
try {
    $mk = Invoke-RestMethod 'https://raw.githubusercontent.com/avstechfr/claude-plugins/main/.claude-plugin/marketplace.json' -TimeoutSec 20
    if ($mk.plugins) { $plugins = @($mk.plugins | ForEach-Object { $_.name }) }
} catch {
    Write-Host "[WARN] marketplace.json injoignable, liste de secours utilisee" -ForegroundColor Yellow
}
$enabled = Get-OuCree $Settings 'enabledPlugins'
foreach ($p in $plugins) { Set-Prop $enabled "$p@avs-plugins" $true }
Write-Host "[OK] Plugins actives : $($plugins -join ', ')" -ForegroundColor Green

# --- 5. statusLine via launcher stable (workaround Anthropic) ---
# Trois pieges resolus ici :
#   1. Sous Windows, Claude Code lance la commande statusLine via cmd qui ne resout PAS ~
#      -> on ecrit un chemin ABSOLU dans settings.json.
#   2. Le chemin du cache contient le numero de version du plugin, qui casse a chaque
#      release -> le launcher resout la DERNIERE version en cache a chaque execution.
#   3. Plus AUCUN `bash` dans la chaine (12/09/2026) : avec WSL installe, `bash` est
#      celui de WSL et ne sait pas ouvrir un chemin C:\... -> statusline vide.
$OldLauncher = Join-Path $ClaudeDir "avs-statusline-launcher.sh"
if (Test-Path $OldLauncher) { Remove-Item $OldLauncher -Force }
$LauncherPath = Join-Path $ClaudeDir "avs-statusline-launcher.mjs"
$LauncherNode = @'
// Launcher statusline AVS : delegue a la derniere version du plugin en cache.
// Genere par bootstrap-avs.ps1 - ne pas editer, relancer le bootstrap pour regenerer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = path.join(os.homedir(), ".claude", "plugins", "cache", "avs-plugins", "avs-statusline");
const cle = (v) => v.split(/[.-]/).map((n) => String(n).padStart(6, "0")).join(".");
let versions = [];
try {
  versions = fs.readdirSync(base).sort((a, b) => cle(a).localeCompare(cle(b)));
} catch {}
const derniere = versions[versions.length - 1];
if (derniere) {
  await import(pathToFileURL(path.join(base, derniere, "bin", "statusline.mjs")).href);
} else {
  // Plugin pas encore telecharge (1er lancement)
  process.stdout.write("AVS - plugin avs-statusline en cours d installation, relance Claude Code\n");
}
'@
[System.IO.File]::WriteAllText($LauncherPath, ($LauncherNode -replace "`r`n", "`n") + "`n", $Utf8SansBom)
$LauncherAbs = $LauncherPath -replace '\\', '/'
Set-Prop $Settings 'statusLine' ([pscustomobject]@{ type = 'command'; command = "node `"$LauncherAbs`"" })

# --- 6. Ecriture (UTF-8 sans BOM : Out-File -Encoding UTF8 en ajoute un sous PS 5.1) ---
[System.IO.File]::WriteAllText($SettingsPath, ($Settings | ConvertTo-Json -Depth 32), $Utf8SansBom)
Write-Host "[OK] settings.json mis a jour" -ForegroundColor Green

# --- 7. Dependances ---
Write-Host ""
Write-Host "=== Dependances ===" -ForegroundColor Cyan
foreach ($o in @(
    @{ nom = 'node'; pourquoi = 'REQUIS : serveurs KB/chat, verrous, statusline'; url = 'https://nodejs.org' },
    @{ nom = 'git';  pourquoi = 'REQUIS : telechargement des plugins'; url = 'https://git-scm.com' }
)) {
    if (Get-Command $o.nom -ErrorAction SilentlyContinue) {
        Write-Host "[OK] $($o.nom) $((& $o.nom --version 2>$null | Select-Object -First 1))" -ForegroundColor Green
    } else {
        Write-Host "[ERR] $($o.nom) absent ($($o.pourquoi)) -> installer depuis $($o.url) puis relancer ce script" -ForegroundColor Red
    }
}

# Le chat choisit seul le backend HTTP quand une cle existe (v2.4.0). Seul un ancien
# reglage explicite "file" peut encore le garder en local.
if ($env:AGENT_CHAT_BACKEND -eq 'file' -or [Environment]::GetEnvironmentVariable('AGENT_CHAT_BACKEND', 'User') -eq 'file') {
    Write-Host "[WARN] AGENT_CHAT_BACKEND=file : le chat reste local. Corriger : setx AGENT_CHAT_BACKEND http" -ForegroundColor Yellow
}

# --- 8. Final ---
Write-Host ""
Write-Host "=== Termine ===" -ForegroundColor Cyan
Write-Host "Ferme puis relance Claude Code pour appliquer." -ForegroundColor Green
Write-Host "Au 1er lancement : 'Trust marketplace avstechfr/claude-plugins?' -> Yes."
Write-Host "Verification : irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/doctor-avs.ps1 | iex"
