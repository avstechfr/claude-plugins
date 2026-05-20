# claude-plugins (AVS Technologies)

Marketplace privee Claude Code de AVS Technologies. Plugins partages a toute l'equipe AVS pour avoir une experience uniforme Claude Code (statusline, MCP, hooks, skills) sur tous les postes et tous les repos.

## Install — Zero action manuelle (recommande)

Coller ces 2 cles dans `~/.claude/settings.json` (sous Windows : `C:\Users\<toi>\.claude\settings.json`) :

```json
{
  "extraKnownMarketplaces": {
    "avs-plugins": {
      "source": {
        "source": "github",
        "repo": "avstechfr/claude-plugins"
      }
    }
  },
  "enabledPlugins": {
    "avs-statusline@avs-plugins": true
  }
}
```

(Si `extraKnownMarketplaces` ou `enabledPlugins` existe deja, fusionner les cles au lieu d'ecraser.)

Au prochain `claude`, le marketplace est connu automatiquement et le plugin s'installe. Aucun `/plugin marketplace add` ni `/plugin install` a taper. La premiere fois, Claude Code demande un consentement "Trust marketplace avstechfr/claude-plugins?" -> Yes, c'est tout.

## Install — Fallback manuel (si tu prefers les slash commands)

```
/plugin marketplace add avstechfr/claude-plugins
/plugin install avs-statusline
```

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
