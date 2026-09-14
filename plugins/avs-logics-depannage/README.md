# avs-logics-depannage

Plugin Claude Code pour le **dépannage Logic'S chez les clients**, en V2 comme en V3. Destiné à
tous les techniciens AVS.

Il apporte deux choses :

| Élément | Ce que c'est | Quand ça sert |
|---|---|---|
| **Skill `logics-depannage`** | Méthode de dépannage guidée + 6 fiches de référence | En intervention : le technicien décrit la panne, Claude qualifie, oriente, donne les commandes et rédige le compte rendu |
| **Agent `logics-depannage`** | Sous-agent d'enquête (lecture seule) | Quand il faut ratisser la KB, les tickets, les logs et les versions du parc, et n'obtenir que la conclusion |

## Installation

Déjà couvert si le poste a été initialisé avec `scripts/bootstrap-avs.ps1`. Sinon :

```
/plugin marketplace add avstechfr/claude-plugins
/plugin install avs-logics-depannage@avs-plugins
```

**Fortement recommandé en complément** : le plugin `avs-mcp-kb`, qui expose la base de
connaissances (`kb_search`, `kb_get`, `kb_log`). La skill fonctionne sans lui — elle bascule
alors sur des appels HTTP à l'API intranet — mais c'est nettement plus fluide avec.

```
/plugin install avs-mcp-kb@avs-plugins
```

Prérequis commun : la variable d'environnement `AVS_API_KEY` (ou le fichier `~/.avs/api_key`).

## Utilisation

La skill se déclenche d'elle-même dès qu'on décrit une panne Logic'S :

> « La caisse de Rhoméo ne sort plus les tickets depuis ce matin »
> « Erreur 70700 chez le Bistrot, en plein service »
> « Il manque une journée dans l'export compta de mai »

On peut aussi l'appeler explicitement : `/logics-depannage`.

Pour déléguer une enquête de fond, demander à Claude de lancer l'agent `logics-depannage`.

## Ce que couvrent les références

| Fichier | Contenu |
|---|---|
| `references/triage.md` | Collecte des infos machine, arbre de triage, questions qui font gagner du temps, pièges de raisonnement |
| `references/v2-v3.md` | Repères de version, qui écrit la chaîne fiscale, Automate (ports, sockets, dépannage), pads, composants de la gamme |
| `references/hfsql.md` | Corruption après coupure, réindexation, erreurs 70xxx, HFSQL Agent et ses pièges, rapatriement de base |
| `references/peripheriques.md` | Imprimante ticket et spouleur, balances (Helmac Data Collect et autres), Glory, TPE, scanner, tiroir, afficheur |
| `references/poste-reseau-cloud.md` | Partages SMB, ouverture de session automatique, accès distant au parc, diagnostic réseau, Logic'S Cloud, licences |
| `references/cloture-nf525.md` | Garde-fous fiscaux, clôture bloquée, écart export / synthèse, journée Z manquante |

## Principes appliqués

- **La KB est la source de vérité.** Les fiches donnent la méthode et les pièges ; le détail à
  jour vit dans la base de connaissances, qui est interrogée en direct.
- **Diagnostiquer avant d'écrire.** Une base client est en production et souvent certifiée
  NF-525 : lire → comprendre → sauvegarder → écriture minimale → vérifier par relecture.
- **Tracer après.** Ticket intranet + note KB. Sinon le collègue suivant refait tout.
- **Escalader ce qui doit l'être.** Bug logiciel, chaîne fiscale, opération Cloud : Nicolas ou Tom.

## Ce que ce plugin ne fait pas

- Il ne remplace pas l'agent **`logics-bases-clients`** (repo `logics`), spécialisé sur les
  opérations de fond en base : clôtures cassées, remap d'IDs, réinjection, jobs bloqués. La skill
  y renvoie explicitement.
- Il ne contient **aucun secret** : mots de passe, clés et credentials restent dans le vault de
  l'intranet et dans la KB. Ce repo est public.

## Contribuer

Le meilleur apport, c'est le **retour de terrain**. Une panne résolue dont la cause n'était pas
évidente :

1. `kb_log` pendant l'intervention — c'est le réflexe prioritaire, et ça profite immédiatement à
   tout le monde.
2. Si le cas est **structurant** (nouvelle famille de pannes, piège méthodologique), l'ajouter à
   la fiche de référence concernée : PR sur `avstechfr/claude-plugins`, en incrémentant la version
   dans `plugins/avs-logics-depannage/.claude-plugin/plugin.json` **et** dans
   `.claude-plugin/marketplace.json` à la racine.
