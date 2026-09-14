#!/usr/bin/env pwsh
# doctor-avs.ps1
# Diagnostic d'un poste AVS : compare l'environnement Claude Code a la reference
# d'equipe et dit ce qui manque, avec la commande pour corriger.
#
# LECTURE SEULE : ce script ne modifie rien. Il est fait pour etre lance chez un
# collegue et pour renvoyer sa sortie.
#
# Usage :
#   irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/doctor-avs.ps1 | iex
#   pwsh -File scripts\doctor-avs.ps1            # en local
#   pwsh -File scripts\doctor-avs.ps1 -Json      # sortie machine, a coller dans un ticket

param([switch]$Json)

$ErrorActionPreference = 'Continue'
$resultats = [System.Collections.Generic.List[object]]::new()

function Note($categorie, $item, $etat, $detail, $correction) {
    $resultats.Add([pscustomobject]@{
        categorie  = $categorie
        item       = $item
        etat       = $etat      # OK | MANQUE | ATTENTION
        detail     = $detail
        correction = $correction
    })
}

$ClaudeDir = Join-Path $HOME ".claude"

# --- 1. Outils de base ------------------------------------------------------
foreach ($o in @(
    @{ nom = 'node'; requis = $true;  pourquoi = 'statusline, MCP, hooks' },
    @{ nom = 'git';  requis = $true;  pourquoi = 'statusline (repo/branche) et clones' },
    @{ nom = 'gh';   requis = $false; pourquoi = 'PR et issues GitHub' }
)) {
    $cmd = Get-Command $o.nom -ErrorAction SilentlyContinue
    if ($cmd) {
        $v = try { (& $o.nom --version 2>$null | Select-Object -First 1) } catch { '' }
        Note 'Outils' $o.nom 'OK' "$v" ''
    } else {
        Note 'Outils' $o.nom ($(if ($o.requis) { 'MANQUE' } else { 'ATTENTION' })) "absent du PATH ($($o.pourquoi))" "installer $($o.nom)"
    }
}

# --- 2. settings.json : marketplace, plugins, statusline --------------------
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$Settings = $null
if (Test-Path $SettingsPath) {
    try { $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json } catch {}
}
if (-not $Settings) {
    Note 'Config' 'settings.json' 'MANQUE' "$SettingsPath illisible ou absent" 'lancer bootstrap-avs.ps1'
} else {
    $mk = $Settings.extraKnownMarketplaces.'avs-plugins'
    Note 'Config' 'marketplace avs-plugins' ($(if ($mk) { 'OK' } else { 'MANQUE' })) `
        $(if ($mk) { "-> $($mk.source.repo)" } else { 'non declare' }) 'lancer bootstrap-avs.ps1'

    foreach ($p in @('avs-statusline', 'avs-mcp-agent-chat', 'avs-mcp-kb', 'avs-logics-depannage')) {
        $actif = $Settings.enabledPlugins."$p@avs-plugins"
        Note 'Plugins' $p ($(if ($actif -eq $true) { 'OK' } else { 'MANQUE' })) `
            $(if ($actif -eq $true) { 'active' } else { 'non active' }) "/plugin install $p@avs-plugins"
    }

    $sl = $Settings.statusLine.command
    if (-not $sl) {
        Note 'Config' 'statusLine' 'MANQUE' 'aucune barre configuree' 'lancer bootstrap-avs.ps1'
    } elseif ($sl -match '(^|\s)bash\s') {
        # Piege connu : sur un poste ou WSL est installe, `bash` est celui de WSL et ne
        # sait pas lire un chemin C:\... -> barre vide, sans message d'erreur.
        Note 'Config' 'statusLine' 'ATTENTION' 'passe par bash (casse si WSL est installe)' 'relancer bootstrap-avs.ps1 (version Node)'
    } elseif ($sl -match '~') {
        Note 'Config' 'statusLine' 'ATTENTION' "chemin avec ~ : cmd ne le resout pas sous Windows" 'relancer bootstrap-avs.ps1'
    } else {
        Note 'Config' 'statusLine' 'OK' 'configuree' ''
    }
}

# --- 3. Versions des plugins installes vs marketplace -----------------------
$clone = Join-Path $ClaudeDir "plugins\marketplaces\avs-plugins"
if (Test-Path "$clone\.claude-plugin\marketplace.json") {
    try {
        $ref = (Get-Content "$clone\.claude-plugin\marketplace.json" -Raw | ConvertFrom-Json).plugins
        foreach ($p in $ref) {
            $cacheDir = Join-Path $ClaudeDir "plugins\cache\avs-plugins\$($p.name)"
            $installees = @(Get-ChildItem $cacheDir -Directory -ErrorAction SilentlyContinue | Select-Object -Expand Name)
            if (-not $installees) {
                Note 'Versions' $p.name 'ATTENTION' "marketplace $($p.version), rien en cache" "/plugin install $($p.name)@avs-plugins"
            } else {
                # Tri par version sans passer par [version] : le cache contient parfois des
                # dossiers nommes par hash de commit, qui font echouer la conversion.
                # Le @(...) est indispensable : avec UNE seule version installee,
                # Sort-Object renvoie une chaine et [-1] prend son dernier CARACTERE
                # ("1.0.0" devenait "0", d'ou un faux "mise a jour disponible").
                $derniere = @($installees | Sort-Object { ($_ -split '[.\-]' | ForEach-Object { $_.PadLeft(6, '0') }) -join '.' })[-1]
                if ($derniere -ne $p.version) {
                    Note 'Versions' $p.name 'ATTENTION' "installe $derniere, disponible $($p.version)" "/plugin update $($p.name)"
                } else {
                    Note 'Versions' $p.name 'OK' $p.version ''
                }
            }
        }
    } catch {}
} else {
    Note 'Versions' 'clone marketplace' 'ATTENTION' 'marketplace pas encore telecharge' 'relancer Claude Code une fois'
}

# --- 4. Serveurs MCP en double ----------------------------------------------
$ClaudeJson = Join-Path $HOME ".claude.json"
if (Test-Path $ClaudeJson) {
    try {
        $cj = Get-Content $ClaudeJson -Raw | ConvertFrom-Json
        $noms = @($cj.mcpServers.PSObject.Properties.Name)
        if ($noms -contains 'agent-chat') {
            # Le serveur vit dans le plugin : une entree globale en plus fait tourner
            # deux serveurs, donc deux identites sur le chat.
            Note 'MCP' 'agent-chat en double' 'ATTENTION' 'declare dans ~/.claude.json ET fourni par le plugin' 'supprimer mcpServers.agent-chat de ~/.claude.json'
        } else {
            Note 'MCP' 'agent-chat' 'OK' 'fourni par le plugin uniquement' ''
        }
    } catch {}
}

# --- 5. Cle API AVS ---------------------------------------------------------
$cle = $env:AVS_API_KEY
if (-not $cle -and (Test-Path (Join-Path $HOME ".avs\api_key"))) {
    $cle = (Get-Content (Join-Path $HOME ".avs\api_key") -Raw).Trim()
}
if (-not $cle) {
    # Sans cle, la skill de depannage et le MCP KB sont aveugles : l'agent parait
    # mauvais alors qu'il n'a simplement acces a rien.
    Note 'Acces' 'AVS_API_KEY' 'MANQUE' 'ni variable d env ni ~/.avs/api_key' 'recuperer sa cle sur https://intra.avstech.fr/api-keys puis setx AVS_API_KEY <cle>'
} else {
    try {
        $r = Invoke-RestMethod -Uri 'https://intra.avstech.fr/api/external/onboarding' -Headers @{ 'X-API-Key' = $cle } -TimeoutSec 15
        Note 'Acces' 'AVS_API_KEY' 'OK' "valide ($($r.user.name ?? $r.user.email ?? 'compte reconnu'))" ''
    } catch {
        Note 'Acces' 'AVS_API_KEY' 'ATTENTION' "presente mais refusee par l intranet : $($_.Exception.Message)" 'verifier la cle sur https://intra.avstech.fr/api-keys'
    }
}

# --- 6. Repos clones --------------------------------------------------------
# Les agents et le contexte metier vivent DANS les repos : sans clone, `logics` prive
# des agents clara / logics-bases-clients / logics-programmation-caisse, et des
# CLAUDE.md qui portent les conventions AVS.
$racines = @(
    (Join-Path $HOME 'Documents\github'),
    (Join-Path $HOME 'AVS'),
    (Join-Path $HOME 'github'),
    (Join-Path $HOME 'source\repos')
) | Where-Object { Test-Path $_ }

$attendus = @(
    @{ nom = 'avs';            pourquoi = 'infra, scripts, CLAUDE.md central' },
    @{ nom = 'logics';         pourquoi = 'agents clara / logics-bases-clients / logics-programmation-caisse' },
    @{ nom = 'logics-cloud';   pourquoi = 'API Cloud, CLAUDE.md' },
    @{ nom = 'intranet-avs';   pourquoi = 'intranet (tickets, sujets, KB)' },
    @{ nom = 'claude-plugins'; pourquoi = 'plugins et scripts AVS' }
)
if (-not $racines) {
    Note 'Repos' 'dossier de travail' 'ATTENTION' 'aucun dossier de repos trouve (Documents\github, ~/AVS, ...)' 'cloner les repos AVS dans ~/Documents/github'
} else {
    foreach ($a in $attendus) {
        $trouve = $racines | ForEach-Object { Join-Path $_ $a.nom } | Where-Object { Test-Path (Join-Path $_ '.git') } | Select-Object -First 1
        if ($trouve) {
            $branche = try { (& git -C $trouve rev-parse --abbrev-ref HEAD 2>$null) } catch { '?' }
            $agents = @(Get-ChildItem (Join-Path $trouve '.claude\agents') -Filter *.md -ErrorAction SilentlyContinue).Count
            Note 'Repos' $a.nom 'OK' "branche $branche$(if ($agents) { ", $agents agent(s) local(aux)" })" ''
        } else {
            Note 'Repos' $a.nom 'MANQUE' $a.pourquoi "git clone https://github.com/avstechfr/$($a.nom).git"
        }
    }
}

# --- 7. CLAUDE.md global ----------------------------------------------------
$md = Join-Path $ClaudeDir "CLAUDE.md"
Note 'Config' 'CLAUDE.md global' ($(if (Test-Path $md) { 'OK' } else { 'ATTENTION' })) `
    $(if (Test-Path $md) { "$([int]((Get-Item $md).Length / 1KB)) Ko" } else { 'absent (regles communes aux agents AVS)' }) `
    'voir onboarding/README.md du repo avs'

# --- Sortie -----------------------------------------------------------------
if ($Json) {
    $resultats | ConvertTo-Json -Depth 5
    return
}

Write-Host ""
Write-Host "=== Diagnostic poste AVS — $env:COMPUTERNAME / $env:USERNAME ===" -ForegroundColor Cyan
Write-Host ""
foreach ($cat in ($resultats | Select-Object -Expand categorie -Unique)) {
    Write-Host "$cat" -ForegroundColor Cyan
    foreach ($r in ($resultats | Where-Object categorie -eq $cat)) {
        $couleur = switch ($r.etat) { 'OK' { 'Green' } 'MANQUE' { 'Red' } default { 'Yellow' } }
        $marque = switch ($r.etat) { 'OK' { '[OK]     ' } 'MANQUE' { '[MANQUE] ' } default { '[ATTENT] ' } }
        Write-Host ("  {0}{1,-26} {2}" -f $marque, $r.item, $r.detail) -ForegroundColor $couleur
    }
    Write-Host ""
}

# dedoublonne : un meme plugin peut etre signale a la fois absent et non installe
$aFaire = $resultats | Where-Object { $_.etat -ne 'OK' -and $_.correction } |
    Sort-Object correction -Unique
if ($aFaire) {
    Write-Host "=== A faire ===" -ForegroundColor Cyan
    foreach ($r in $aFaire) { Write-Host ("  - {0,-26} {1}" -f $r.item, $r.correction) }
    Write-Host ""
    Write-Host "Envoie cette sortie a Nicolas si quelque chose n'est pas clair." -ForegroundColor Yellow
} else {
    Write-Host "Poste conforme a la reference d'equipe." -ForegroundColor Green
}
