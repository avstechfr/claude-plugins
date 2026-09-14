# Triage — par où commencer

## Collecte des infos machine (à faire en premier, systématiquement)

Ces éléments répondent à la moitié des questions avant même de chercher.

```powershell
# Version de Logic'S installée (adapter le chemin si l'install n'est pas standard)
Get-ChildItem "C:\LogicS\*.exe" | Select-Object Name, @{n='Version';e={$_.VersionInfo.FileVersion}}

# Configuration : base, serveur, numéro de poste
Get-Content "C:\LogicS\data\Params.ini"

# Processus Logic'S actifs
Get-Process | Where-Object { $_.ProcessName -match "Logic|manta|HFSQL" } | Select-Object ProcessName, Id, StartTime

# Logs applicatifs (les plus récents d'abord)
Get-ChildItem "C:\LogicS\logs\" | Sort-Object LastWriteTime -Descending | Select-Object -First 10

# Extinctions violentes / redémarrages non propres (cause n°1 de corruption HFSQL)
Get-WinEvent -FilterHashtable @{LogName='System'; ID=41,6008,1074} -MaxEvents 20 |
  Select-Object TimeCreated, Id, Message
```

`Params.ini` est lu dans l'ordre `<dossier_exe>\data\Params.ini` puis `C:\LogicS\data\Params.ini`.
Clé utile : `BDD_Nom` (nom de la base), et les paramètres serveur / numéro de poste.

**AVS-Tools** (`C:\Users\<user>\Tools\`, déployable chez le client par un `.bat` auto-extractible)
automatise une grande partie de cette collecte : *Info Système*, *Diagnostic Réseau Complet*,
*Diagnostic HFSQL* (service, port 4900, BDD, tailles de tables, connexions), *Analyse extinctions
violentes*, *Test Imprimante* (ESC/POS direct port 9100), *Rapport d'intervention*.
Si le poste ne l'a pas, l'y déployer vaut souvent le temps investi.

## Arbre de triage

### 1. Logic'S ne démarre pas du tout

1. Y a-t-il eu une **coupure de courant** ou un arrêt violent ? → suspecter une corruption HFSQL,
   voir `hfsql.md`.
2. Le **service HFSQL** tourne-t-il (base en client/serveur) ? Port `4900` joignable ?
3. Le **serveur de caisse** est-il joignable depuis le poste (ping + partage) ? → `poste-reseau-cloud.md`
4. **Licence / activation** refusée ? Message explicite à l'écran → `poste-reseau-cloud.md`
5. Version de l'exe cohérente avec celle des autres postes ? Une MAJ partielle casse un parc.

### 2. Logic'S démarre mais plante ou affiche une erreur HFSQL

- Noter le **code d'erreur exact** (70xxx). Voir `hfsql.md` pour les plus fréquents.
- Est-ce sur **un seul poste** ou sur tous ? Un seul poste → local (fichier, droits, version).
  Tous → serveur / base.
- Est-ce **reproductible** ? Quelle manip précise déclenche ? C'est ce qui permettra à Nicolas
  ou Tom de corriger si c'est un bug.

### 3. Un périphérique ne répond plus

→ `peripheriques.md`. Réflexe : **tester le périphérique hors Logic'S d'abord** (impression
Windows de test, test ESC/POS direct sur le port 9100, pesée sur la balance seule). Si ça
échoue hors Logic'S, ce n'est pas un problème Logic'S.

### 4. Problème de clôture, de Z, d'export comptable, de totaux

→ `cloture-nf525.md`. **Ne rien écrire en base avant d'avoir lu ce fichier.**

### 5. Le pad / la tablette / le totem ne se connecte plus

→ `v2-v3.md` (sockets Automate, ports, bind loopback vs LAN) puis `poste-reseau-cloud.md`
(réseau, wifi, IP du serveur).

### 6. Problème de synchro ou d'affichage côté Logic'S Cloud

→ `poste-reseau-cloud.md`. Rappel : **la caisse est la source de vérité**, le Cloud n'est qu'un
miroir alimenté en push. Une donnée absente du Cloud mais présente en caisse n'est pas une
perte de données.

## Les questions qui font gagner le plus de temps

- « **Ça marchait quand, la dernière fois ?** » puis « **qu'est-ce qui a changé entre les deux ?** »
- « **Est-ce que ça le fait sur les autres postes ?** »
- « **Est-ce que ça le fait tout le temps, ou seulement à un moment précis ?** »
  (au démarrage, à l'encaissement CB, à la clôture, en heure de service = contention multi-postes)
- « **Le message d'erreur, il dit quoi exactement ?** » — faire lire ou photographier, ne pas
  se contenter d'un résumé du client.

## Pièges de raisonnement à éviter

- **Ping OK ne veut pas dire réseau OK.** Une « erreur 5 » sur un partage est une erreur
  d'authentification, pas de réseau.
- **Un service « arrêté » peut être un service qui a planté** et dont la politique de
  redémarrage est épuisée (cas du spouleur d'impression). Regarder les journaux, pas juste l'état.
- **Un symptôme visible côté caisse peut avoir sa cause côté serveur** (et inversement).
  Vérifier des deux côtés avant de conclure.
- **Ne pas faire confiance à un nom de fichier de sauvegarde** : vérifier son contenu avant de
  s'en servir pour restaurer quoi que ce soit.
