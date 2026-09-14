# Bases HFSQL — dépannage données

> ⚠️ **Ce repo est public. Aucun mot de passe, aucune clé, aucune IP client dans ces fichiers.**
> Le mot de passe HFSQL commun aux bases clients et les credentials serveurs sont dans le
> **vault de l'intranet** et dans la KB. Les récupérer au moment de l'intervention, ne jamais
> les recopier ici ni dans un ticket.

## Principe directeur

**Diagnostiquer AVANT d'écrire.** Une base client est en production et souvent sous certification
NF-525 : toute écriture est irréversible côté client.

**lire → comprendre → sauvegarder → réparer avec l'écriture minimale → vérifier par relecture.**

En cas de doute sur une écriture : s'arrêter et demander à Nicolas. Ne jamais lancer un `.exe`
Logic'S sur le poste du technicien.

## Ne jamais déduire une structure depuis le code

La structure des tables est documentée dans le repo `logics` :
`Code/Gestion-V3/Tables-BDD/<Table>.md` (couvre Gestion, Encaissements **et** Automate V3 —
l'analyse HFSQL est partagée). L'export SQL lisible `Analyse - W.X.Y.Z.txt` fait foi sur la
structure réellement en place. Voir aussi `Documentation/Fonctionnel/Architecture_Donnees/`.

## Cas courant n°1 — corruption après coupure de courant

**Symptôme** : Logic'S Encaissements ne démarre pas ou erreur à l'ouverture ; les fichiers de
tickets sont inaccessibles. HFSQL Classic n'est pas transactionnel : une coupure pendant une
écriture corrompt le fichier.

Fichiers typiquement touchés, dans `C:\LogicS\data\` :
`caisse_ticket_entete.fic / .ndx / .mmo` et `caisse_ticket_ligne.fic / .ndx / .mmo`.

**Procédure** :
1. Fermer complètement Logic'S (aucune instance en cours).
2. **Sauvegarder le dossier `data` avant toute chose.**
3. Réindexer via le Centre de Contrôle HFSQL ou WDOptimiseur.
4. Si la réindexation ne suffit pas, la suppression des fichiers corrompus les recrée vides à
   la réindexation suivante : **seul le ticket en cours de saisie au moment de la coupure est
   perdu**, l'historique et les ventes facturées ne sont pas impactés. Sur une base certifiée
   NF-525, valider avec Nicolas avant de supprimer quoi que ce soit.

**Prévention à proposer au client** : onduleur sur le poste caisse, et sauvegardes automatiques
quotidiennes. Une caisse sans onduleur reviendra.

## Cas courant n°2 — doublon à la création d'un article

Erreur de doublon sur `Article_Multi_Codes` à la création d'un article, typiquement sur une
installation neuve : le compteur d'auto-incrément est désynchronisé. **Réindexer la base en
local sur le poste** remet le compteur d'aplomb.

## Cas courant n°3 — collisions d'ID, erreurs 70233 / 70700 / 70100

| Code | Ce que ça veut dire en pratique |
|---|---|
| **70233** | Valeur négative affectée à un identifiant automatique. Symptôme classique d'un mécanisme de génération d'ID qui a renvoyé `-1` sans garde en aval |
| **70700** | Conflit d'écriture concurrente (plusieurs écrivains sur le même enregistrement). Typiquement `Caisse_Table_Encours`, qui a de nombreux points d'écriture répartis entre les caisses **et** le spooler serveur. Se manifeste en heure de service |
| **70100** | Contention sur un verrou de lecture / écriture |
| **70022** | Mot de passe fichier manquant ou incorrect |

Points à retenir :

- Les IDs sont créés via la procédure dédiée (`Proc_ID_Creation`), **jamais** par un simple
  incrément. Un `-1` qui arrive jusqu'à l'écriture produit un 70233.
- Les 70700 sur `Caisse_Table_Encours` sont **indépendants du système d'ID** : c'est une course
  entre plusieurs écrivains, par conception. Certaines procédures ont un retry, d'autres non.
- **Pads et caisses partagent la même table de compteurs** : un parc en versions mixtes
  (caisse à jour, pad resté en arrière) produit un système incohérent. Vérifier les deux.
- Un flot d'alertes « Erreur non fatale Encaissement » aux heures de service, sur plusieurs
  postes, oriente vers de la contention, pas vers une panne matérielle.

Ces symptômes sont des **bugs applicatifs** : les tracer précisément (client, dates, postes,
codes, pile d'appel si visible) et **escalader à Nicolas / Tom**. Le technicien ne les corrige pas.

## Cas courant n°4 — données manquantes dans l'historique / l'export

Écart entre l'export ventes et la synthèse mensuelle, journée absente de l'historique alors que
la clôture existe → voir `cloture-nf525.md`. **Ne rien écrire avant de l'avoir lu.**

## L'outil : HFSQL Agent

`HFSQL_Agent.exe` (déployé sous `C:\logics\hfsql_agent\`) est le **seul moyen fiable** de lire ou
modifier un `.fic` HFSQL. Jamais de bricolage binaire en PowerShell.

Il se pilote par un fichier de configuration de 8 lignes (action, chemin, table, champ, valeur,
limite, mot de passe fichier, mode). Détail du format, des actions disponibles et de tous les
pièges : nœud KB **« Maintenance des bases HFSQL clients Logic'S (dépannage données) »**
(`kb_search "maintenance bases HFSQL clients"`).

### Les pièges qui font échouer « au hasard »

- **Le mode détermine la sémantique d'écriture.** `classic` → l'ID fourni est **ignoré**
  (auto-incrément). `cs` → l'ID fourni est **respecté**. Réinjection, remap, restauration d'un ID
  précis = **obligatoirement `cs`**.
- **Base servie (production) → jamais d'écriture en `classic`** : les `.fic` sont verrouillés par
  le service, échec et risque de corruption. Écrire en `cs`. **En cas de doute : `cs`.**
- **En mode `cs`, le chemin ne choisit pas la base** : c'est la configuration (`Params.ini`) qui
  décide. Après avoir déposé une base sous un nouveau nom : éditer `Params.ini` **et redémarrer
  le service HFSQL** (pas de découverte à chaud).
- **Connexion serveur sans mot de passe** : le mot de passe fichier va uniquement sur sa ligne
  dédiée, jamais dans le paramètre de connexion serveur — sinon ça casse net.
- Les DLLs du runtime WinDev doivent être **à côté de l'exe**, sinon blocage silencieux (pas de
  timeout, pas de message).
- L'action `sql` est **client/serveur uniquement** et **ne fait pas de JOIN** : lectures séparées
  puis recroisement.
- Un retour `ok:false` peut être un **faux négatif** : relire avant de rejouer l'opération.
- Le fichier de configuration doit être en **UTF-8 sans BOM avec fins de ligne CRLF**, sinon
  l'action n'est pas reconnue.
- **Exécuter l'agent localement sur la caisse**, pas à travers un tunnel distant : la latence
  provoque des insertions en double.

### Table de décision rapide

```
LIRE   (list / read / struct / sql / count) : base servie -> cs ; base non servie -> classic ; sql -> cs obligatoire
ÉCRIRE (add / update / delete)              : imposer un ID -> cs ; base en production -> cs
En cas de doute                             : cs
```

## Rapatrier une base client pour analyse

Ordre à essayer quand l'accès direct est muet : **SMB (`c$`) → RDP → VNC → l'outil de prise en
main à distance**. Copier avec `robocopy`, et **toujours refermer la connexion réseau** après
(`net use \\<hôte>\c$ /delete`).

- Localiser le **vrai** serveur HFSQL : lire `HFConf.ini` → `DBRootPath` du service. Un dossier
  `C:\ServeurHF\BDD` peut très bien être un dossier orphelin figé qui n'est plus servi.
- Une copie à chaud d'une base servie est acceptable **pour un diagnostic**, jamais pour une
  restauration fiscale.
- Pour pousser un fichier vers un poste Windows : serveur HTTP temporaire +
  `Invoke-WebRequest`. Pas de base64 par stdin SSH (ça casse au-delà de ~1 Mo).
- Contrôler la **fraîcheur** d'une base rapatriée avant de s'en servir : comparer le dernier
  numéro de clôture avec les archives de sauvegarde présentes.

## Quand passer la main

L'agent Claude Code **`logics-bases-clients`** (dans le repo `logics`) est spécialisé sur les
opérations de fond : clôtures cassées, jobs zombies, remap d'IDs, réinjection, incohérences de
synchro Cloud. Dès que l'intervention dépasse « réindexer » ou « lire une valeur », c'est lui
qu'il faut, ou Nicolas directement.
