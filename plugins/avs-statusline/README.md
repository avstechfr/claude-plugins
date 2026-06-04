# avs-statusline

Status line Claude Code AVS : sujet en cours, nom du repo, agent (`.claude/agent-name`), branche Git, modele actif.

## Rendu

```
🎯 #133 Rhoméo Décoration · 📁 avs · 🤖 automate · 🌿 main · ✨ Opus 4.8 (1M context)
```

Le `🎯` n'apparait que si un sujet courant est defini (voir plus bas) ; sinon la ligne demarre a `📁`.

Conventions :
- **Sujet** : contenu de `~/.claude/sujets/<repo-key>.txt` (voir [Sujet en cours](#sujet-en-cours))
- **Repo** : basename de `git rev-parse --show-toplevel`
- **Agent** : contenu de `.claude/agent-name` a la racine du repo (gitignore, propre a chaque clone). Exemple : `automate`, `pad`, `cloud`
- **Branche** : sortie de `git rev-parse --abbrev-ref HEAD`
- **Modele** : champ `model.display_name` du JSON Claude Code

## Sujet en cours

La statusline affiche le sujet/dossier AVS sur lequel on travaille, lu depuis un fichier texte cote workstation :

```
~/.claude/sujets/<repo-key>.txt
```

- **`<repo-key>`** = chemin absolu du repo (`git rev-parse --show-toplevel`) avec tout caractere non alphanumerique remplace par `_`.
  Exemple : `C:\Users\Nicolas\Documents\github\avs` -> `C__Users_Nicolas_Documents_github_avs.txt`
- **Contenu** : une ligne libre, en UTF-8 (sans BOM). Exemple : `#133 Rhoméo Décoration`
- **Absent ou vide** : aucun `🎯` n'est affiche.

Le fichier est ecrit par l'agent Claude quand on ouvre/change de sujet (il connait le numero + titre via l'API intranet). Le keying est **par repo** : toutes les fenetres ouvertes sur le meme repo partagent le sujet affiche.

## Install

**Limitation Anthropic (mai 2026)** : la clé `statusLine` n'est PAS supportee dans le `settings.json` d'un plugin (seules `agent` et `subagentStatusLine` le sont). Le plugin distribue donc le script, mais l'utilisateur doit declarer `statusLine` dans son `~/.claude/settings.json` perso.

### Etape 1 — Activer le plugin (auto via `extraKnownMarketplaces`)

Dans `~/.claude/settings.json` :

```json
{
  "extraKnownMarketplaces": {
    "avs-plugins": {
      "source": { "source": "github", "repo": "avstechfr/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "avs-statusline@avs-plugins": true
  }
}
```

Au prochain `claude`, le plugin est telecharge dans `~/.claude/plugins/cache/avs-plugins/avs-statusline/<version>/`.

### Etape 2 — Declarer la statusLine (manuel, une fois)

Ajouter aussi dans `~/.claude/settings.json` :

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/plugins/cache/avs-plugins/avs-statusline/1.1.0/bin/statusline-dispatch.sh"
  }
}
```

Au prochain demarrage de Claude Code, la status line s'affiche.

⚠️ Le numero de version `1.1.0` dans le chemin doit etre mis a jour si le plugin est versionne ulterieurement. Suivre les releases sur https://github.com/avstechfr/claude-plugins/releases

## Detail technique

| Plateforme | Script execute |
|------------|----------------|
| Windows (Git Bash, MSYS, Cygwin) | `bin/statusline-dispatch.sh` -> `bin/statusline.ps1` (via `pwsh` ou `powershell`) |
| macOS / Linux | `bin/statusline-dispatch.sh` -> `bin/statusline.sh` (jq optionnel, fallback grep) |

Le dispatcher fait le sniff OS via `$OSTYPE` et delegue. Un seul `command` dans `settings.json` plugin, fonctionne partout.

## Personnaliser

Si tu veux changer la mise en forme (autres emojis, ordre des champs, ajout du contexte window %), edite `bin/statusline.ps1` et `bin/statusline.sh` de la meme facon, puis push une nouvelle version du plugin sur `avstechfr/claude-plugins`. Les utilisateurs feront `/plugin update avs-statusline` pour recuperer.

## Convention `.claude/agent-name`

Chaque repo AVS suit la convention "un agent par projet" : on depose un fichier `.claude/agent-name` contenant un slug court (`automate`, `pad`, `cloud`, `intranet`, etc.) qui identifie le scope de l'agent Claude qui travaille dans ce repo. Ce fichier est gitignore (un agent vit cote workstation, pas dans le code source partage).
