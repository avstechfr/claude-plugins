# claude-plugins (AVS Technologies)

> Documentation fonctionnelle (usage, installation, problemes connus, deploiement equipe) : [`docs/fonctionnel.md`](docs/fonctionnel.md)

Marketplace privee Claude Code de AVS Technologies. Plugins partages a toute l'equipe AVS pour avoir une experience uniforme Claude Code (statusline, MCP, hooks, skills) sur tous les postes et tous les repos.

## Installer sur un poste (une commande, pas de compte GitHub)

Dans PowerShell (celui de Windows suffit, pas besoin de PowerShell 7) :

```powershell
irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/bootstrap-avs.ps1 | iex
```

Le script :

1. demande la cle API personnelle (https://intra.avstech.fr/api-keys) si le poste n'en a pas de valide, la verifie aupres de l'intranet et l'ecrit dans `~/.avs/api_key` ;
2. declare le marketplace et active **tous** les plugins listes dans `.claude-plugin/marketplace.json` (liste lue en direct) ;
3. configure la statusline (chemin absolu, launcher Node qui suit la derniere version) ;
4. verifie Node et Git. Backup automatique du `settings.json`, les autres reglages sont conserves.

Puis relancer Claude Code, et repondre Yes a "Trust marketplace".

Idempotent : **quand un plugin est ajoute au depot, relancer la meme commande suffit** a l'activer.

### Verifier un poste

```powershell
irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/doctor-avs.ps1 | iex
```

Lecture seule. Liste ce qui manque avec la correction.

### Pourquoi un fichier `~/.avs/api_key` et pas une variable d'environnement

Claude Code lance depuis l'app de bureau, VS Code ou un autre terminal n'herite pas du profil PowerShell, et les serveurs MCP n'heritent jamais du profil du shell. Une cle posee seulement dans `$PROFILE` etait invisible : KB, chat et verrous paraissaient installes mais ne marchaient pas, sans erreur. Tous les plugins AVS lisent donc `AVS_API_KEY` puis, a defaut, `~/.avs/api_key`.

### Piste : imposer les plugins depuis la console admin Claude

Sur un abonnement Team/Enterprise, *Admin Settings > Claude Code > Managed settings* peut pousser `extraKnownMarketplaces` et `enabledPlugins` a toute l'organisation (https://code.claude.com/docs/en/server-managed-settings.md). Non active chez AVS a ce jour ; la cle API reste de toute facon a poser par poste.

## Plugins dispo

| Plugin | Role | Besoin |
|--------|------|--------|
| `avs-statusline` | Barre du bas : sujet AVS en cours, repo, branche, modele | Node |
| `avs-mcp-agent-chat` | Chat entre agents Claude Code (chat_send / chat_recv), partage equipe via l'intranet | cle API |
| `avs-mcp-kb` | Base de connaissances en outils natifs (kb_search / kb_get / kb_save / kb_link / kb_log) | cle API |
| `avs-logics-depannage` | Depannage Logic'S V2/V3 chez le client : skill guidee + subagent d'enquete | cle API conseillee |
| `avs-locks` | Verrous de sous-projet du repo avs (process #74), liberes au git push | cle API |

Versions : voir `.claude-plugin/marketplace.json`.

## Convention `.claude/agent-name`

Chaque repo AVS suit la convention : un fichier `.claude/agent-name` (gitignore) contient le slug court de l'agent qui travaille dans le repo. Exemples : `automate` (repo logics), `pad` (logics-mobile-v3), `cloud` (logics-cloud), `intranet`, `display`, etc.

Ce fichier est utilise par `avs-statusline` pour afficher l'identite de l'agent et par `avs-mcp-agent-chat` pour identifier la session MCP.

## Workflow contributeur

1. Cloner ce repo, creer une branche
2. Ajouter / modifier un plugin sous `plugins/<nom>/`
3. Mettre a jour le numero de version dans `plugins/<nom>/.claude-plugin/plugin.json` ET dans `.claude-plugin/marketplace.json`
4. Push + PR
5. Les postes recuperent la nouvelle version au lancement suivant de Claude Code (**penser a bumper la version**, sinon le cache garde l'ancienne). Un **nouveau** plugin est active par la relance de `bootstrap-avs.ps1`.
