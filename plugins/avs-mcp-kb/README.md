# avs-mcp-kb

MCP server qui expose la **base de connaissances AVS** (intra.avstech.fr) comme outils natifs
dans Claude Code. La KB est le cerveau partagé des agents : sa présence permanente dans la
liste d'outils sert de rappel, et la friction du `curl` disparaît.

## Outils

| Outil | Usage |
|-------|-------|
| `kb_search` | Recherche hybride (sémantique + full-text + fuzzy) + traversée du graphe. **Début de tâche, nom inconnu, avant de questionner l'utilisateur, avant le web, face à une erreur.** |
| `kb_get` | Lit un nœud complet par id (kb_search tronque le contenu à 200 caractères). |
| `kb_save` | Crée ou met à jour un nœud. Refuse un secret en visibility public. |
| `kb_link` | Crée une relation entre deux nœuds (un nœud orphelin est invisible en traversée). |
| `kb_log` | Journalise une leçon apprise / action significative, la range dans sa branche d'ossature (`part_of`) et la relie au meilleur voisin sémantique. |

## Rappel automatique (`hooks/kb-rappel.mjs`)

À la fin d'un tour, si l'agent a agi sans rien écrire dans la KB, il est relancé une fois pour
le faire, ou pour dire en une ligne qu'il n'y a rien à retenir.

**Chaque session AVS doit laisser une trace** : une session interactive qui n'a encore rien écrit
est relancée une fois, même sans action. Une session perso n'écrit rien et le dit en une ligne ;
`claude -p` et le SDK (scripts, tâches planifiées) ne sont relancés que pour leurs actions.
`AVS_KB_RAPPEL_SESSION=0` (dans `env` de `settings.json`) coupe cette règle sur un poste.

- **Ce qui compte comme action** : accès au parc (SSH, WinRM, adresse Tailscale), `git push`,
  PR, déploiements, écritures sur l'intranet, scripts lancés depuis `~/AVS/`, fichiers écrits
  dans `~/AVS/memory` ou `~/AVS/workspace`, sous-agents capables d'agir.
- **Cadence** : 1er rappel tout de suite, puis au plus toutes les 30 min. Une action de
  production (`git push`, PR, déploiement, `psql`…) est rappelée à la fin de son tour.
- **Une copie locale garde la main** : si `~/.claude/hooks/kb-rappel.mjs` existe, celui du
  plugin ne fait rien (pas de double relance). Retirer la copie et son entrée dans
  `settings.json` pour passer sur le plugin.

**Limites** : le rappel obtient une écriture, pas sa qualité ; l'agent peut juger qu'il n'y a
rien à retenir. Il ne voit pas une fenêtre fermée en plein tour, ni ce que fait un sous-agent.
Pour le vérifier sur un poste :

```
node plugins/avs-mcp-kb/hooks/kb-audit.mjs 30
```

liste les sessions des 30 derniers jours terminées avec des actions non suivies d'une écriture.

Tests : `node --test plugins/avs-mcp-kb/hooks/kb-rappel.test.mjs`

## Installation

```
/plugin marketplace add avstechfr/claude-plugins
/plugin install avs-mcp-kb@avs-plugins
```

**Zéro dépendance** : le serveur n'utilise que la stdlib Node (JSON-RPC stdio implémenté en
direct). Aucun `npm install` nécessaire, fonctionne dès le clone du plugin. Le bootstrap
d'équipe (`scripts/bootstrap-avs.ps1`) l'active automatiquement.

## Authentification

Le serveur cherche la clé API dans cet ordre :

1. Variable d'environnement `AVS_API_KEY` (déjà exportée par le `.bashrc` des postes AVS)
2. Fichier `~/.avs/api_key` (la clé brute, une ligne)

Chaque utilisateur utilise **sa** clé personnelle (https://intra.avstech.fr/api-keys) : elle
détermine ce qu'il voit (visibilités public/restricted/admin selon le rôle) et alimente les
métriques d'usage KB de la page api-keys.

`AVS_INTRANET_URL` permet de pointer ailleurs (défaut : https://intra.avstech.fr).

## Notes d'implémentation

- Tous les corps POST/PUT sont échappés en ASCII (`\uXXXX`) : contourne le bug historique de
  double-encodage UTF-8 de l'API externe.
- `kb_save`/`kb_log` refusent un contenu qui ressemble à un secret (mot de passe, clé, token)
  si `visibility` = public — règle AVS : secret → `admin`.
- `kb_log` fait l'auto-maillage (v1.1.0) : query sémantique sur le titre + le début du contenu.
  1. **Branche** : lien `part_of` vers un nœud `Ossature — …` (tag `ossature`, miroir de la carte
     `/organisation`). Soit celle passée en paramètre `branche`, soit une branche remontée par la
     recherche, soit la branche du meilleur voisin.
  2. **Voisin** : lien `related_to` vers la fiche la plus proche, jamais vers un nœud d'ossature.
  Avant la v1.1.0, le lien `related_to` partait vers le premier résultat, souvent un nœud très
  général (« AVS Technologies », « GK41 ») : la KB était devenue une étoile (audit du 30/09/2026).

## Test

```
AVS_API_KEY=avs_xxx node smoke-test.mjs
```

Le smoke test liste les outils, fait un `kb_search` réel, un `kb_get`, vérifie le refus des
secrets en public, puis crée et supprime un nœud de test (aucune pollution de la KB).
