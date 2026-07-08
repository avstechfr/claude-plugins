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
| `kb_log` | Journalise une leçon apprise / action significative et la relie automatiquement au meilleur voisin sémantique du graphe. |

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
- `kb_log` fait l'auto-maillage : query sémantique sur le titre, edge `related_to` vers le
  meilleur voisin trouvé.

## Test

```
AVS_API_KEY=avs_xxx node smoke-test.mjs
```

Le smoke test liste les outils, fait un `kb_search` réel, un `kb_get`, vérifie le refus des
secrets en public, puis crée et supprime un nœud de test (aucune pollution de la KB).
