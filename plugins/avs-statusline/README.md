# avs-statusline

Status line Claude Code AVS : nom du repo, agent (`.claude/agent-name`), branche Git, modele actif.

## Rendu

```
📁 logics · 🤖 automate · 🌿 main · ✨ Opus 4.7 (1M context)
```

Conventions :
- **Repo** : basename de `git rev-parse --show-toplevel`
- **Agent** : contenu de `.claude/agent-name` a la racine du repo (gitignore, propre a chaque clone). Exemple : `automate`, `pad`, `cloud`
- **Branche** : sortie de `git rev-parse --abbrev-ref HEAD`
- **Modele** : champ `model.display_name` du JSON Claude Code

## Install

```
/plugin marketplace add avstechfr/claude-plugins
/plugin install avs-statusline
```

Au prochain demarrage de Claude Code (`exit` puis `claude`), la status line s'affiche en bas du terminal en permanence.

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
