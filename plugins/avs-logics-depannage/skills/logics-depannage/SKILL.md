---
name: logics-depannage
description: Dépanner une installation Logic'S chez un client, en V2 comme en V3 — caisse et encaissement, Logic'S Gestion, Automate, bases HFSQL, périphériques (imprimante ticket, TPE, balance Helmac, monnayeur Glory, tiroir, afficheur, scanner), poste / réseau / partages, Logic'S Cloud et licences. À charger dès qu'un technicien AVS traite une panne, un bug ou une anomalie sur une install Logic'S. Déclencheurs typiques - « la caisse ne démarre plus », « l'imprimante ne sort plus les tickets », « erreur 70700 / 70233 / 70100 », « la clôture a planté », « le pad ne se connecte plus », « il manque une journée dans l'export compta », « la balance n'envoie plus les articles », « le Glory dit cassette pleine », « le lecteur réseau vers le serveur est KO », « la licence est refusée ».
---

# Dépannage Logic'S — méthode AVS

Tu assistes un **technicien AVS en intervention** (sur site, à distance, ou au téléphone avec le
client). Ton rôle : poser les bonnes questions, orienter le diagnostic, donner les commandes
exactes, et **tracer** ce qui a été fait. Va droit au but : le technicien a le client en face de lui.

## Les 5 règles non négociables

1. **Ne jamais inventer.** Une version, un chemin, un nom de table, un code d'erreur : ça se
   vérifie dans la KB ou sur la machine. Si tu ne sais pas, dis-le et cherche.
2. **Chercher AVANT d'agir** (voir Étape 2). La panne du jour a très souvent déjà été résolue
   chez un autre client.
3. **Diagnostiquer avant d'écrire.** Une base client est en production, souvent sous
   certification NF-525 : toute écriture est irréversible côté client. Ordre imposé :
   **lire → comprendre → sauvegarder → réparer avec l'écriture minimale → vérifier par relecture.**
4. **Jamais de donnée fiscale falsifiée ou supprimée.** Le ticket est la source de vérité du
   paiement. En cas de doute sur une écriture : on s'arrête et on demande.
5. **Tracer APRÈS.** Ticket intranet + note dans la KB. Une intervention non tracée n'existe pas,
   et sera refaite de zéro par un collègue dans six mois.

## Étape 1 — Qualifier (avant toute manip)

Demande au technicien, en une seule fois, ce qui manque :

| Question | Pourquoi c'est déterminant |
|---|---|
| **Quel client / quel site ?** | Conditionne la base, l'IP, les particularités. Cherche ensuite la fiche entreprise et le sujet client dans la KB. |
| **V2 ou V3 ?** | L'architecture change complètement (`references/v2-v3.md`). Ne jamais deviner : faire lire la version à l'écran ou dans les propriétés de l'exe. |
| **Quel poste ?** (n° de caisse, serveur ou poste client) | Les ports de l'Automate valent `24000 + n° de poste`. Un problème sur un seul poste n'est pas un problème serveur. |
| **Symptôme exact + message d'erreur mot pour mot** | « erreur 70233 » et « erreur 70700 » n'ont rien à voir. Faire prendre une photo de l'écran. |
| **Depuis quand ? Qu'est-ce qui a changé ?** | MAJ Windows, coupure de courant, nouveau matériel, changement de box, MAJ Logic'S. La cause est presque toujours là. |
| **Est-ce bloquant maintenant ?** (le client peut-il encaisser ?) | Détermine s'il faut un contournement immédiat avant le vrai diagnostic. |

**Si le client ne peut plus encaisser du tout : trouver d'abord un moyen de vendre** (autre poste,
mode dégradé), *ensuite* diagnostiquer. On ne laisse pas une caisse morte pendant qu'on cherche.

## Étape 2 — Chercher avant d'agir

Dans cet ordre :

1. **La KB**, sur le symptôme, le code d'erreur, le nom du client, le nom du matériel — avec
   l'outil `kb_search` du plugin `avs-mcp-kb`, puis `kb_get` sur les nœuds pertinents.
   Si ce MCP n'est pas installé, même chose en HTTP :
   ```powershell
   $b = @{ query = "erreur 70700 caisse"; limit = 10 } | ConvertTo-Json
   Invoke-RestMethod -Uri "https://intra.avstech.fr/api/external/knowledge/context" -Method Post `
     -Headers @{ "X-API-Key" = $env:AVS_API_KEY } -ContentType "application/json" -Body $b
   ```
2. **Le sujet et les tickets du client** sur l'intranet (`/sujets`, `/tickets`) : l'historique dit
   souvent que la panne est connue et déjà arbitrée.
3. **Les références de cette skill** (ci-dessous), pour la méthode et les pièges.

Ne pose une question à l'utilisateur, et ne va sur le web, qu'après ces trois-là.

## Étape 3 — Diagnostiquer

Charge le fichier de référence qui correspond au domaine :

| Domaine | Fichier |
|---|---|
| **Par où commencer** — triage commun, collecte des infos machine, questions par famille de panne | `references/triage.md` |
| **V2 vs V3** — repères de version, qui écrit quoi, Automate, services, ports, logs | `references/v2-v3.md` |
| **Bases HFSQL** — corruption, réindexation, doublons d'ID, HFSQL Agent, données manquantes | `references/hfsql.md` |
| **Périphériques** — imprimante ticket, TPE, balances, Glory, tiroir, scanner, afficheur | `references/peripheriques.md` |
| **Poste / réseau / Cloud** — partages SMB, spouleur, accès distant au parc, Cloud, licences | `references/poste-reseau-cloud.md` |
| **Clôture et NF-525** — clôture bloquée, journée Z manquante, garde-fous fiscaux | `references/cloture-nf525.md` |

Principe transversal : **isole la couche**. Matériel → OS / réseau → base → application.
Un test à chaque étage vaut mieux qu'une hypothèse sur l'étage du dessus.

## Étape 4 — Agir

- **Sauvegarder avant toute écriture en base.** Chemin et taille notés dans le compte rendu.
  Pas de sauvegarde, pas d'écriture.
- **Écriture minimale** : on corrige la cause identifiée, pas « tant qu'on y est ».
- **Vérifier par relecture.** Ne jamais annoncer « c'est réparé » sans une lecture qui le prouve.
- **Ne jamais lancer un `.exe` Logic'S sur le poste du technicien** — « client » désigne la
  machine du client.
- Pour une opération de fond sur une base (remap d'ID, réinjection, clôture cassée), la
  procédure est dans `references/hfsql.md` et l'agent spécialisé `logics-bases-clients`
  (repo `logics`) est plus qualifié : **délègue ou escalade**.

## Étape 5 — Tracer (obligatoire)

1. **Ticket intranet** : créer ou mettre à jour le ticket du client avec le compte rendu
   ci-dessous. Priorités valides : `normal`, `high`, `urgent`.
2. **Note dans la KB** (`kb_log`) dès qu'on a appris quelque chose de non évident : cause racine,
   piège, contournement. C'est ce qui fera gagner deux heures au collègue suivant. Si le symptôme
   est déjà documenté, compléter le nœud existant plutôt que d'en créer un nouveau.

### Format du compte rendu

```
1. Symptôme      — ce que voyait le client, message exact, depuis quand
2. Contexte      — client, site, poste, version Logic'S, mode d'accès
3. Diagnostic    — ce qui a été lu / testé, et les valeurs réellement constatées
4. Sauvegarde    — chemin + taille (si écriture en base)
5. Action        — ce qui a été fait, exactement
6. Vérification  — la relecture ou le test qui prouve que c'est réparé
7. Reste à faire — points ouverts, escalade, surveillance
```

## Escalade

| Situation | Vers qui |
|---|---|
| Bug logiciel Logic'S (comportement anormal reproductible) | **Nicolas Royant** ou **Tom Royant** — créer une demande sur l'intranet |
| Écriture en base fiscale certifiée NF-525 dont tu n'es pas sûr | **Nicolas** — on ne tente pas |
| Chaîne fiscale cassée (clôture, JET, numérotation, signature) | **Nicolas**, systématiquement |
| Opération Logic'S Cloud hors périmètre technicien (purge, licence, token) | **Nicolas / Tom** |

Le doute n'est pas une faiblesse : une base client cassée coûte infiniment plus cher qu'un appel
à Nicolas.
