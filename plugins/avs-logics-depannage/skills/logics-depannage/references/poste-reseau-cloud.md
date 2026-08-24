# Poste, réseau, accès distant, Cloud et licences

> ⚠️ **Repo public** : aucun mot de passe, aucune clé, aucune IP client dans ce fichier.
> Credentials dans le vault de l'intranet, IP et accès dans la KB / l'inventaire du parc.

## Partages réseau vers le serveur de caisse

Symptôme classique : le poste caisse ne voit plus `\\serveur\base`, alors que le ping passe.

**« Ping OK » ne veut pas dire « réseau OK ».** Une **erreur 5** est une erreur
d'**authentification SMB**, pas de connectivité.

Deux causes fréquentes, souvent combinées, après une mise à jour Windows du serveur :

1. **L'accès invité SMB est désactivé** (les versions récentes de Windows le coupent par défaut,
   y compris rétroactivement à l'occasion d'une mise à jour majeure).
2. **Le compte de session utilisé n'a pas de mot de passe.** Windows interdit par défaut
   l'utilisation en réseau des comptes à mot de passe vide
   (`LimitBlankPasswordUse`). En local ça marche, en réseau non — d'où le « ça marchait avant ».

Diagnostic :

```powershell
Test-NetConnection <serveur> -Port 445 -InformationLevel Quiet
net use \\<serveur>\<partage>          # lire le code d'erreur exact
Get-SmbServerConfiguration | Select-Object EnableSMB1Protocol, EnableSMB2Protocol, AuditSmb1Access
Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name LimitBlankPasswordUse
```

Résolution : soit réactiver l'accès invité côté client SMB, soit passer
`LimitBlankPasswordUse` à `0`, soit — le plus propre — **donner un vrai mot de passe au compte
de session** et le déclarer dans la configuration. Le choix se discute avec le client :
mettre un mot de passe sur une session de caisse a des conséquences opérationnelles
(ouverture automatique de session, notamment).

## Ouverture de session automatique de la caisse

Une caisse doit démarrer seule après une coupure. La **source de vérité est la clé de registre**
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`, pas la case à cocher de
`netplwiz`.

Piège vécu : un registre Winlogon qui a l'air parfait mais dont le `DefaultPassword` ne
correspond pas au compte (typiquement un compte sans mot de passe) → la session ne s'ouvre plus
au démarrage. Le correctif est **du côté du compte**, pas du registre.

## Accès distant au parc

- Les caisses du parc sont accessibles par **SSH** (utilisateur dédié, clé du parc), et
  l'inventaire des machines est exposé par l'intranet (`/api/external/servers`).
- Un **proxy SSH** est également disponible via l'API intranet (`POST /api/external/ssh`) : il
  attend un champ `host` et un mot de passe d'autorisation **distinct** du mot de passe de
  session. **Trois essais ratés = verrou de 15 minutes** — ne jamais tenter en force, aller
  chercher le bon secret dans le vault.
- Détails à jour (nom de clé, utilisateur, endpoints, pièges de quoting) :
  `kb_search "acces parc SSH caisses"` et `kb_search "Lutty"`.

Pièges de quoting connus sur ces accès SSH : les commandes en une ligne avec guillemets simples
sont fiables ; passer un script par stdin ajoute un BOM et modifie les échappements ; `$true`
peut être perdu (utiliser `1` / `0`).

## Diagnostic réseau côté poste

```powershell
ipconfig /all
Test-NetConnection <ip-serveur> -Port 4900 -InformationLevel Quiet   # HFSQL Client/Serveur
Test-NetConnection <ip-serveur> -Port 2212 -InformationLevel Quiet   # serveur de caisse (MAJ)
Get-NetRoute | Select-Object -First 15
Resolve-DnsName <serveur>
```

AVS-Tools fait la même chose en un clic (*Diagnostic Réseau Complet*, *Test Ports*, *Scan IP*,
*Ping Monitor* pour une surveillance dans la durée quand la panne est intermittente).

Sur les pannes intermittentes (« ça coupe deux fois par jour »), poser une surveillance et
revenir avec des mesures vaut mieux que diagnostiquer sur le ressenti du client.

## Logic'S Cloud

**Principe à connaître avant toute intervention Cloud** : la **caisse est la source de vérité**.
Le Cloud PostgreSQL est un **miroir alimenté en push**, intégralement reconstructible depuis la
base HFSQL. Il sert à observer (portail client, ComCom, Totem, stats, monitoring des sauvegardes),
pas à opérer.

Conséquences pratiques :

- Une donnée présente en caisse mais absente du Cloud **n'est pas une perte de données** : c'est
  un problème de synchronisation, qu'on peut rejouer.
- La synchro caisse → Cloud est **idempotente** : pousser deux fois la même donnée ne crée pas
  de doublon.
- La conformité NF-525 vit **côté caisse**. Le Cloud ne fait pas foi sur le fiscal.
- **Attention aux données qui n'existent QUE côté Cloud** (comptes utilisateurs, entreprises et
  établissements, tokens d'API, archives et alertes de sauvegarde, réglages ComCom, journaux
  d'activité) : celles-là ne sont pas reconstructibles. Précaution maximale.
- Quelques flux vont dans l'autre sens (ComCom, Totem) : une commande créée côté Cloud et pas
  encore récupérée par la caisse **ne doit pas être purgée**, sinon la commande est perdue.

### Purge du CA d'essai après une installation

Remettre la caisse à zéro **ne vide pas** le Cloud : le miroir est push-based et en insertion
seule pour des raisons NF-525. Il n'existe pas d'endpoint de purge accessible au technicien →
**ça remonte à Nicolas ou Tom**. Procédure de référence : `kb_search "purger CA essai Logic'S Cloud"`.

### Tokens d'API Cloud

Deux modes : **token Entreprise** (accès à tous les établissements du client, l'établissement doit
être passé en paramètre) et **token Établissement** (restreint à un seul, forcé par le token).
Un message du type « accès refusé : établissement introuvable ou n'appartenant pas à votre
société » signale presque toujours une incohérence entre le token utilisé et l'établissement
demandé.

## Licences et activations

- Format de clé : `LOGICS-XXXX-XXXX-XXXX-XXXX`.
- Types : perpétuelle, abonnement annuel ou mensuel, essai (30 jours), démo.
- Statuts : active, expirée, suspendue, révoquée.
- La validation se fait auprès de l'API de licences, avec un **heartbeat** régulier et une
  **période de grâce hors ligne de 7 jours** avant blocage. Un poste bloqué après une longue
  coupure Internet, c'est souvent ça.
- L'activation est liée à un identifiant machine : la détection de clonage est active, donc un
  changement matériel important (carte réseau, disque) peut invalider une activation.
- **Bug connu en mode démo** : chaque base de démonstration ouverte consomme une activation
  distincte (l'identifiant machine est stocké par base et non au niveau de la machine), ce qui
  sature vite le nombre de postes autorisés. Non corrigé — si un poste de démo sature, c'est
  probablement ça, escalader plutôt que multiplier les licences.
- **Gestion des modules d'une licence** : depuis l'intranet, fiche entreprise → onglet Licences →
  modifier la licence → section Modules / Options. Un module n'apparaît que s'il appartient au
  produit rattaché à la licence (exemple : les modules par marque de balance ne sont visibles que
  sur une licence Logic'S Étiquetage).
