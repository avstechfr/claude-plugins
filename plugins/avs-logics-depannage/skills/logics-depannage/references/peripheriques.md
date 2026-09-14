# Périphériques

**Réflexe n°1 : tester le périphérique hors Logic'S.** Si l'imprimante ne sort pas une page de
test Windows, si la balance ne pèse pas seule, si le TPE ne fait pas sa télécollecte, le problème
n'est pas dans Logic'S — et on gagne une heure.

Matériels intégrés côté Logic'S : imprimante ticket (port COM ou Windows), tiroir-caisse
(COM / OPOS), afficheur client (COM), scanner code-barres (COM ou émulation clavier), TPE
(protocole bancaire), balances (Precia DataCollect et DCH, HSM+, Helmac, LPC, Marques ETPOS),
monnayeur Glory (API SOAP), lecteur de badges Dallas iButton.

---

## Imprimante ticket

### Diagnostic par couches

1. **Alimentation, papier, capot, voyant.** Oui, vraiment, en premier.
2. **Test hors Logic'S** :
   - Imprimante réseau : test **ESC/POS direct sur le port 9100**, ce qui court-circuite le
     spouleur Windows (outil *Test Imprimante* d'AVS-Tools).
   - Imprimante USB / COM : page de test depuis les propriétés de l'imprimante Windows.
3. **Le spouleur Windows** — voir ci-dessous, c'est un classique.
4. **La configuration dans Logic'S** : Paramètres > Imprimantes / Périphériques. Vérifier le port
   et le modèle. Un changement de port USB suffit à tout casser.

### Le spouleur qui « s'arrête »

Un spouleur qui apparaît arrêté est très souvent un spouleur qui a **planté**, pas un service
qu'on aurait éteint. Cause fréquente : le *language monitor* du driver de l'imprimante ticket
qui fait tomber `spoolsv.exe`. La politique de redémarrage par défaut d'un service Windows
n'autorise que **deux** redémarrages : une salve de trois plantages au démarrage suffit à laisser
le service mort pour la journée.

Vérifications :

```powershell
Get-Service Spooler | Select-Object Status, StartType
sc.exe qfailure Spooler                       # politique de redémarrage
Get-WinEvent -LogName Application -MaxEvents 50 |
  Where-Object { $_.Message -match "spoolsv|Spouleur" } | Select-Object TimeCreated, Id, Message
# Monitors d'impression déclarés (des monitors orphelins d'un driver désinstallé plantent le service)
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors"
```

Traitement durable : redémarrage perpétuel du service (`sc.exe failure Spooler ...`), démarrage
différé, suppression des monitors orphelins, et surveillance. AVS-Tools embarque *Nettoyage
Spooler* et un **SpoolerWatchdog** (installation, désinstallation, exécution manuelle) pour ça.

#### Cas connu : Star TSP100 (`tsp100lm.dll`)

Signature très reconnaissable : une **salve de trois crashs `spoolsv.exe` (`c0000005`) dans les
5 min qui suivent le boot**, puis plus rien jusqu'au reboot suivant. Le *language monitor*
`tsp100lm.dll` (driver Star TSP100 / futurePRNT) interroge l'imprimante USB avant que Windows ne
l'ait énumérée — race condition au démarrage. Ces trois crashs épuisent les deux redémarrages du
recovery par défaut, et le service reste mort pour la journée.

Diagnostic ciblé : sur un événement `Application` Id 1000 concernant `spoolsv.exe`, lire
`Properties[3]` pour le **module fautif**, et comparer sa version à celle du driver dans le
DriverStore — un écart trahit des **packs constructeur empilés** (cause racine).

Ici le correctif durable va plus loin qu'un simple `sc failure` : recovery **perpétuel**
(`reset= 0`), démarrage différé (`DelayedAutoStart=1`, à re-forcer car `sc config start=
delayed-auto` ne l'écrit pas de façon fiable), suppression des monitors orphelins, **et un
watchdog** — parce que le recovery Windows ne couvre **pas** l'arrêt propre (`Stop-Service`) et
que Windows 11 n'émet plus l'événement SCM 7036. Procédure complète, scripts et rollback :
`kb_search "spouleur Star TSP100 tsp100lm"`.

### Bons cuisine / bar qui ne sortent pas

Le serveur d'impression Logic'S (`PrintS\Logic'S - Serveur Impression.exe`) est piloté par
l'Automate. Vérifier qu'il tourne, et regarder `C:\LogicS\logs\`. Si l'Automate ne répond plus,
voir `v2-v3.md`.

### Ticket mal formé (texte tronqué, police trop grande)

Ce n'est pas un problème matériel mais un problème de **modèle d'état** côté Logic'S :
tracer précisément (quel ticket, quel champ tronqué, capture) et escalader à Nicolas / Tom.

---

## Balances

### Helmac — mode Data Collect

Chaîne : **balance Helmac → logiciel HTR → fichier TXT → Logic'S Encaissements → ticket**.

Points de configuration :
- Liaison **RS-232** (broches 2, 3, 4, 5), vitesse **19200 bauds**.
- Côté balance : *Menu Pro > Configuration > Programmation > Hardware > Communication*, et
  *Mode Balance > Ticket* (code-barres Custom EAN13, en-tête 21 sur 2 chiffres, numéro de ticket
  sur 5 chiffres, montant sur 5 chiffres → format `[21RRRRRFFFFF]`).
- Côté Logic'S Gestion : option *Data Collect Helmac*.
- Côté Logic'S Encaissements : *Paramètres > Périphériques > Balance > Helmac*, Network Number
  **21**, vitesse **19200**.
- Envoi des articles : *Gestion > Liste Articles > [Envoyer Balance]*.
- Voir les tickets balance côté caisse : touche fonction **86**.

| Problème | À vérifier |
|---|---|
| Ticket balance non reçu | HTR lancé, port COM correct, « Rouvrir Ticket » sur la balance |
| Articles non envoyés | Code touche, puis relancer *Envoyer Balance* |
| Code-barres non reconnu | Format EAN13 et Network Number = 21 des deux côtés |

Les **erreurs du module fiscal Helmac** ont leur propre documentation (codes, diagnostics,
réinitialisation) : `kb_search "erreurs fiscales Helmac"` pointe vers le PDF sur le Drive.

### Autres balances

Precia (DataCollect, DCH, D900), HSM+, LPC (Precia Connector), Marques ETPOS. Les manuels
opérateur et utilisateur sont dans la KB : `kb_search "manuel Precia"`, `kb_search "ETPOS Marques"`.

L'envoi des articles vers les balances passe par un **spooler** interne à Logic'S : la demande
est déposée dans une table de mise à jour et traitée au cycle suivant. Un envoi qui « ne part
pas » peut simplement attendre son cycle — vérifier avant de tout reconfigurer.

Sur Logic'S Étiquetage, les **modules par marque de balance** (Helmac, Dibal, Precia, Marques,
Dini Argeo) sont des options de licence : si une marque n'apparaît pas, vérifier les modules
activés sur la licence côté intranet (voir `poste-reseau-cloud.md`).

---

## Monnayeur Glory

Intégration par **API SOAP**. Le logiciel vérifie que le monnayeur est en état *IDLE* avant
d'accepter un paiement, avec un heartbeat et un indicateur d'état visible à l'écran. Un Glory qui
n'est pas prêt bloque donc l'encaissement.

### Interface web

`http://<ip-du-glory>:3000/control` — inventaire, état des cassettes, alertes.

### Cas connu : cassette de collecte annoncée pleine alors qu'elle est vide

Alerte rouge et compteur élevé sur la cassette de collecte alors qu'elle vient d'être vidée ;
la caisse est bloquée parce qu'elle croit la cassette de délestage pleine.

**Cause** : la tige métallique qui actionne le switch de présence de la cassette est tordue, donc
le retrait / la réinsertion n'est pas détecté et le compteur ne se remet pas à zéro.

**Diagnostic** : dans l'interface web, vérifier l'inventaire de la cassette ; *Menu > Collecte >
Vérification* — une erreur `RESULT=32` indique que le Glory demande une vérification physique.

**Solution** (intervention sur site) :
1. **Laisser le Glory allumé** pendant toute la manipulation — sinon le capteur ne verra pas le
   mouvement.
2. Ouvrir, localiser la tige du switch de présence, la redresser délicatement si elle est tordue.
3. Retirer complètement la cassette, attendre quelques secondes, la réinsérer jusqu'au clic.
4. Vérifier que l'alerte a disparu et que le compteur est revenu à zéro.

Si la tige n'est pas en cause, vérifier le switch lui-même et son câblage.

### Codes d'erreur Glory

Les manuels de codes d'erreur par modèle (CI-5, CI-5C, CI-10, CI-10BX, CI-10CX) sont dans la KB :
`kb_search "Glory codes erreur <modèle>"`.

---

## TPE / monétique

- Tester **hors Logic'S** : le TPE fait-il sa télécollecte, répond-il seul ?
- Vérifier la liaison (COM / IP) et la configuration côté Logic'S.
- Un crash reproductible **au moment précis de l'encaissement CB** est un bug applicatif :
  récupérer les logs du poste (et du pad si c'est un pad), noter le montant et le moyen de
  paiement exacts, puis escalader à Nicolas / Tom.

---

## Scanner, tiroir, afficheur

- **Scanner** : mode émulation clavier ou port COM. Tester dans le Bloc-notes : si les codes
  n'arrivent pas là, c'est le scanner ou sa config, pas Logic'S.
- **Tiroir-caisse** : ouvert par impulsion via l'imprimante ticket dans la grande majorité des
  installs. Un tiroir qui ne s'ouvre plus est donc très souvent un **problème d'imprimante**.
- **Afficheur client** : port COM série, vérifier port et vitesse.

## Fournisseur

Perimatic fournit une partie du parc (imprimantes ticket, tiroirs, TPV JOA). Les fiches et
contacts sont dans la KB : `kb_search "Perimatic"`.
