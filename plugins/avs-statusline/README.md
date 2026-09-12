# avs-statusline

Status line Claude Code AVS : sujet AVS en cours, nom du repo, dossier courant, agent (`.claude/agent-name`), branche Git, modele actif.

## Rendu

```
🎯 #133 RHOMEO DECORATION - Installation… · 📁 avs · 📂 site-web/app · 🤖 automate · 🌿 main · ✨ Opus 5
```

Le `🎯` n'apparait que si un sujet est connu pour la session ; sinon la ligne demarre a `📁`.

Conventions :
- **Sujet** : contenu de `~/.claude/sujets/session-<session_id>.txt`, ecrit par les hooks (voir [Sujet en cours](#sujet-en-cours))
- **Repo** : basename de `git rev-parse --show-toplevel`
- **Dossier courant** : chemin du cwd relatif a la racine du repo (`.` a la racine) ; hors repo git, basename du cwd
- **Agent** : le nom sous lequel les autres agents te voient sur le chat (registre
  `~/.avs/agent-chat/agents.json` tenu par `avs-mcp-agent-chat`, derive du sujet en cours).
  Repli sur `.claude/agent-name` tant qu'aucun nom de chat n'est enregistre pour la session.
  Depuis la v2.2.0 : avant, ce segment affichait toujours `.claude/agent-name`, versionne par
  repo — toutes les fenetres d'un meme repo montraient le meme nom, et il y avait deux
  notions concurrentes de "nom d'agent"
- **Branche** : sortie de `git rev-parse --abbrev-ref HEAD`
- **Modele** : champ `model.display_name` du JSON Claude Code

## Sujet en cours

Le sujet est **pose automatiquement par les hooks du plugin** (`hooks/hooks.json` +
`hooks/sujet-hook.mjs`). Trois signaux, du plus fiable au moins fiable ; un signal faible
n'ecrase jamais un signal fort dans la meme session :

| Evenement | Signal | Exemple |
|---|---|---|
| `UserPromptSubmit` | numero ou titre cite par l'humain | « on reprend le **#172** », « on avance sur **Rhomeo** » |
| `PostToolUse` | l'agent appelle l'API sujets | `POST /api/external/sujets/<id>/notes` |
| `Stop` | filet : un Haiku choisit dans la liste des sujets ouverts | deduit de la conversation, au plus une fois par demi-heure |

Le titre est resolu via `GET /api/external/sujets` (cle `AVS_API_KEY` ou `~/.avs/api_key`),
mis en cache 12 h dans `~/.claude/sujets/.cache-sujets.json`, et tronque a ~42 caracteres.
`SessionEnd` supprime le fichier de la session et purge ceux de plus de 7 jours.

### Le sujet est REVISE, pas fige (v2.1.0)

La barre doit dire sur quoi on travaille **maintenant**. Un signal fort (numero cite, appel
a l'API sujets) protege donc le sujet pendant **30 minutes seulement** ; ensuite le filet a
le droit de reviser. Il repasse toutes les **20 minutes** et remplace le sujet si la
conversation a derive — une session de quatre heures change de sujet en route.

Et s'il repond que plus aucun sujet ne correspond, le sujet affiche est **efface** (des lors
qu'il date de plus de 30 min) plutot que laisse en place : pas de `🎯` vaut mieux qu'un
`🎯` qui ment. C'etait le defaut de la v2.0.0 : le premier `#172` prononce restait affiche
jusqu'a la fin de la session, meme deux heures apres avoir change de chantier.

**Pourquoi des hooks et pas une consigne dans CLAUDE.md** : jusqu'a la v2.0.0, ecrire ce
fichier etait demande a l'agent en prose. Mesure faite le 12/09/2026 : ~15 sessions
renseignees en 3 mois. Ce qui doit arriver a chaque fois doit etre execute par le harnais.

**Pourquoi plus de fallback par repo** : `~/.claude/sujets/<repo-key>.txt` etait partage par
toutes les fenetres ouvertes sur le repo et n'etait jamais rafraichi — celui du repo `avs`
datait de deux mois et affichait un sujet faux en permanence. Supprime en v2.0.0 : mieux
vaut pas de `🎯` qu'un `🎯` qui ment.

### Poser le sujet a la main

```bash
echo "#133 Rhomeo Decoration" > ~/.claude/sujets/session-<session_id>.txt
```

Ne **jamais** ecrire dans un fichier `<repo-key>.txt` : il n'est plus lu, et il l'etait par
toutes les autres fenetres.

## Install

**Limitation Anthropic** : la cle `statusLine` n'est pas supportee dans le `settings.json`
d'un plugin (contrairement aux hooks, eux bien pris en charge). Le plugin distribue donc le
script, mais la cle `statusLine` doit vivre dans le `~/.claude/settings.json` de l'utilisateur.

### Recommande — le bootstrap fait tout

```powershell
irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/bootstrap-avs.ps1 | iex
```

Il declare le marketplace, active les plugins, genere `~/.claude/avs-statusline-launcher.mjs`
(qui suit automatiquement la derniere version en cache) et pointe `statusLine` dessus.

### Manuel

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:/Users/TON_USER/.claude/plugins/cache/avs-plugins/avs-statusline/2.0.0/bin/statusline.mjs\""
  }
}
```

⚠️ **Chemin ABSOLU obligatoire sous Windows** : Claude Code lance la commande via `cmd`, qui
ne resout pas `~`. Avec `~/...`, la commande echoue en silence et aucune statusline ne
s'affiche (constate le 10/07/2026).

## Detail technique

Un seul script, `bin/statusline.mjs`, execute par `node` sur les trois OS.

**Pourquoi Node et plus bash+PowerShell** (v2.0.0, 12/09/2026) : l'ancien
`bin/statusline-dispatch.sh` choisissait sa cible avec `$OSTYPE`. Sur un poste Windows ou
**WSL est installe, le `bash` du PATH est celui de WSL**, pas Git Bash : il repond
`OSTYPE=linux-gnu`, part sur la branche Linux, et ne sait meme pas ouvrir un chemin
`C:\...`. Resultat : plus aucune statusline, sans le moindre message d'erreur. Le
diagnostic a pris du temps parce que le script PowerShell, lui, fonctionnait parfaitement
quand on l'appelait a la main.

`bin/statusline-dispatch.sh` reste comme shim (`exec node statusline.mjs`) pour les postes
bootstrappes avant la v2.0.0. **Node.js est desormais requis** — il l'etait deja pour les
MCP AVS.

## Personnaliser

Editer `bin/statusline.mjs`, bumper la version dans `.claude-plugin/plugin.json` **et** dans
`.claude-plugin/marketplace.json`, pousser sur `avstechfr/claude-plugins`. Les utilisateurs
recuperent avec `/plugin update avs-statusline`.

## Convention `.claude/agent-name`

Chaque repo AVS suit la convention "un agent par projet" : un fichier `.claude/agent-name`
contenant un slug court (`automate`, `pad`, `cloud`, `central`…) qui identifie l'agent Claude
qui travaille dans ce repo. Ce fichier est gitignore (un agent vit cote workstation).
