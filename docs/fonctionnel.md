# Plugins Claude Code AVS — documentation fonctionnelle

> Pour qui : toute personne de l'équipe AVS qui utilise Claude Code, et l'admin qui équipe les postes.
> Doc technique : `README.md` du dépôt et README de chaque plugin. Suivi : sujet intranet #181.

## 1. À quoi ça sert

Les plugins AVS donnent à chaque agent Claude Code de l'équipe les mêmes capacités, quel que soit le poste :

| Plugin | Ce que l'utilisateur y gagne | Comment on s'en sert |
|---|---|---|
| **avs-mcp-kb** | L'agent consulte la base de connaissances avant d'agir et y note ce qu'il apprend | Automatique ; ou demander « cherche dans la KB… » (`kb_search`, `kb_log`) |
| **avs-mcp-agent-chat** | Les agents de toute l'équipe peuvent s'écrire (coordination, questions) | « demande à l'agent de Tom… » (`chat_send`, `chat_recv`) ; les messages reçus s'affichent seuls |
| **avs-logics-depannage** | Dépannage Logic'S V2/V3 guidé chez le client (caisse, Automate, HFSQL, périphériques, réseau, Cloud, clôture NF-525) | `/logics-depannage` ou décrire la panne |
| **avs-locks** | Deux agents ne peuvent pas modifier le même sous-projet du repo `avs` en même temps ; le verrou tombe au `git push` | Automatique |
| **avs-statusline** | Barre du bas : sujet AVS en cours, repo, branche, modèle | Automatique |

## 2. Installer ou mettre à jour un poste

**Une seule commande**, dans PowerShell (celui livré avec Windows suffit). Aucun compte GitHub nécessaire.

```powershell
irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/bootstrap-avs.ps1 | iex
```

Déroulé vu par l'utilisateur :

1. Le script demande la **clé API personnelle** si le poste n'en a pas de valide. Elle se trouve sur https://intra.avstech.fr/api-keys (chacun la sienne : elle détermine ce que l'agent voit et à qui ses actions sont attribuées).
2. Il vérifie la clé auprès de l'intranet, l'enregistre sur le poste, active **tous** les plugins AVS et configure la barre d'état.
3. L'utilisateur ferme puis relance Claude Code et répond **Yes** à « Trust marketplace ».

La commande est **relançable sans risque** : les autres réglages Claude Code sont conservés (sauvegarde automatique). **Quand un nouveau plugin sort, on relance la même commande.** Les mises à jour des plugins existants arrivent seules au lancement de Claude Code.

Nouveau salarié (poste complet : dossiers `~/AVS`, identité, CLAUDE.md global, clone du repo, plugins) : `irm https://intra.avstech.fr/setup-dev.ps1 | iex`, avec un token remis par un admin (voir `onboarding/README.md` du repo `avs`).

## 3. Vérifier que tout marche

- **Test rapide** : dans Claude Code, demander « fais un kb_search sur Logic'S ». Des résultats de la KB = OK.
- **Diagnostic complet** (ne modifie rien) :

```powershell
irm https://raw.githubusercontent.com/avstechfr/claude-plugins/main/scripts/doctor-avs.ps1 | iex
```

Chaque ligne est OK / ATTENTION / MANQUE, avec la correction à appliquer. Envoyer la sortie à Nicolas en cas de doute.

## 4. Problèmes connus et réponses

| Symptôme | Cause | Réponse |
|---|---|---|
| Seul le plugin de dépannage marche | Scripts d'avant le 17/09/2026 (plantaient sous PowerShell 5.1) | Relancer la commande d'installation |
| Les outils KB / chat existent mais ne renvoient rien ou « clé introuvable » | Clé API seulement dans le profil PowerShell : invisible quand Claude Code est lancé depuis l'app de bureau ou VS Code | Relancer la commande : elle écrit la clé dans `~/.avs/api_key` |
| Personne ne répond sur le chat | Chat en mode local (ancienne variable `AGENT_CHAT_BACKEND=file`) | `setx AGENT_CHAT_BACKEND http`, relancer Claude Code |
| Barre d'état vide | Node absent, ou ancienne config passant par `bash` | Installer Node, relancer la commande |
| Un plugin annoncé n'apparaît pas | Poste configuré avant sa sortie | Relancer la commande |

**Règle pour les agents** : face à ces symptômes, un agent AVS donne la commande unique ci-dessus, jamais une procédure GitHub ou plugin par plugin (règle d'onboarding KB priorité 14).

## 5. Ajouter un plugin (développeurs)

1. Branche + PR sur `avstechfr/claude-plugins` (`main` protégée, relecture avant fusion).
2. Déclarer le plugin dans `.claude-plugin/marketplace.json` : il sera activé chez chacun à la prochaine exécution de la commande d'installation.
3. À chaque évolution, **incrémenter la version** dans `plugin.json` et `marketplace.json`, sinon les postes gardent l'ancienne.
4. Un plugin qui appelle l'intranet lit la clé via `AVS_API_KEY`, puis `~/.avs/api_key`.
5. Tester les scripts PowerShell sous `powershell.exe` (5.1), pas seulement `pwsh`.
6. Mettre à jour ce document et le node KB « Claude Code plugins AVS ».

## 6. Déploiement dans l'équipe

| Date | Étape |
|---|---|
| 08/04/2026 | Mail « process unifié agents IA » à toute l'équipe |
| 14/09/2026 | Mail à Fred (Tom en copie) : son plugin de dépannage publié, procédure en 4 étapes — n'a pas fonctionné pour les autres plugins |
| 17/09/2026 | Correctifs (PR #2) : commande unique compatible Windows 5.1, clé dans un fichier, chat partagé automatique. Règle agents ajoutée à l'onboarding |
| 17/09/2026 | Mail à Fred (Tom en copie) « Agents Claude Code AVS : installation en une commande » |
| À venir | Retour de Fred, puis envoi au reste de l'équipe (destinataires à décider avec Nicolas) |

Piste non activée : la console admin Claude (Team/Enterprise, *Managed settings*) peut imposer le marketplace et les plugins à toute l'organisation ; la clé API resterait à poser par poste.
