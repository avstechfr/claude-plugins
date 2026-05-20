# claude-plugins (AVS Technologies)

Marketplace privee Claude Code de AVS Technologies. Plugins partages a toute l'equipe AVS pour avoir une experience uniforme Claude Code (statusline, MCP, hooks, skills) sur tous les postes et tous les repos.

## Install

⚠️ **Limitation Anthropic (mai 2026)** : la clé `statusLine` n'est PAS supportee dans le `settings.json` d'un plugin. Le plugin distribue donc le script mais l'utilisateur doit declarer `statusLine` dans son `~/.claude/settings.json` perso (cf. plugin README).

### 1. Coller dans `~/.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "avs-plugins": {
      "source": { "source": "github", "repo": "avstechfr/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "avs-statusline@avs-plugins": true
  },
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/plugins/cache/avs-plugins/avs-statusline/1.0.0/bin/statusline-dispatch.sh"
  }
}
```

(Fusionner les cles si elles existent deja.)

### 2. Relancer Claude Code (`exit` puis `claude`)

Le plugin est telecharge automatiquement, et la statusline pointe vers son script. Aucun `/plugin marketplace add` ni `/plugin install` a taper.

## Install — Fallback manuel via slash commands

```
/plugin marketplace add avstechfr/claude-plugins
/plugin install avs-statusline
```

(Faut quand meme ajouter la cle `statusLine` au settings perso, voir plugin README.)

## Plugins dispo

| Plugin | Description | Statut |
|--------|-------------|--------|
| `avs-statusline` | Status line permanente : repo + agent + branche + modele | publie v1.0.0 |
| `avs-mcp-agent-chat` | MCP agent-chat preconfigure (HTTP backend + `.claude/agent-name`) | a venir |
| `avs-hooks` | Hooks AVS communs (encodage WinDev, secrets, etc.) | a venir |

## Convention `.claude/agent-name`

Chaque repo AVS suit la convention : un fichier `.claude/agent-name` (gitignore) contient le slug court de l'agent qui travaille dans le repo. Exemples : `automate` (repo logics), `pad` (logics-mobile-v3), `cloud` (logics-cloud), `intranet`, `display`, etc.

Ce fichier est utilise par `avs-statusline` pour afficher l'identite de l'agent et par `avs-mcp-agent-chat` pour identifier la session MCP.

## Workflow contributeur

1. Cloner ce repo, creer une branche
2. Ajouter / modifier un plugin sous `plugins/<nom>/`
3. Mettre a jour le numero de version dans `plugins/<nom>/.claude-plugin/plugin.json` ET dans `.claude-plugin/marketplace.json`
4. Push + PR
5. Les utilisateurs recuperent via `/plugin update <nom>`
