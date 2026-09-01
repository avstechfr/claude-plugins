# Clôture, journée Z et garde-fous NF-525

> **C'est le domaine le plus sensible du dépannage Logic'S.** Une erreur ici a des conséquences
> fiscales pour le client. Lire ce fichier en entier avant d'écrire quoi que ce soit.

## Les garde-fous

1. **Le ticket est la source de vérité du paiement.** On ne falsifie ni ne supprime jamais une
   donnée fiscale.
2. **La chaîne fiscale se calcule côté caisse**, pas dans le Cloud : signature des tickets,
   archivage, séquence des numéros, journal des événements. Le Cloud ne fait pas foi.
3. Sur une base **certifiée NF-525**, préserver la chaîne d'intégrité est prioritaire sur le
   confort du client. Si une correction casserait le chaînage, on ne la fait pas : on escalade.
4. **En V3, seul l'Automate V3 écrit la chaîne fiscale.** Un ticket manquant se diagnostique
   côté Automate (jobs, worker, logs), pas côté caisse. Voir `v2-v3.md`.
5. Tout ce qui touche à une clôture cassée, à la numérotation ou à la signature :
   **Nicolas, systématiquement.**

## Symptôme : la clôture a planté / est bloquée

À collecter avant tout :

- Le message exact et l'heure.
- La journée concernée et le numéro de clôture.
- Est-ce que le client a pu rouvrir et continuer à vendre ?
- Est-ce que ça s'est déjà produit chez lui ?

Ce que le technicien peut faire :

- Vérifier que la caisse et l'Automate tournent, lire `C:\LogicS\logs\` (et en V3 la trace du
  service Automate).
- Vérifier que le serveur / la base répond.
- **Ne pas relancer une clôture en boucle** : une clôture partiellement écrite qu'on rejoue
  aggrave la situation.

Ce qui relève de Nicolas ou de l'agent `logics-bases-clients` : jobs restés bloqués, clôture à
réparer ou à découper, chaîne de numérotation à reprendre.

## Symptôme : refus à l'encaissement `ENCAISSEMENT_KO` / `LIGNES_DIRECTES`

L'automate NF-525 **refuse le ticket** au moment de l'encaissement :
`Code : ENCAISSEMENT_KO` — `Message : Sous-proc LIGNES_DIRECTES a échoué (cf. JET / Proc_Trace)`.

**Cause** : écart d'arrondi entre les lignes et le pied de ticket sur de la **vente au poids /
au mètre** (quantités non entières, ex. 0,65). La somme des lignes arrondies au centime diffère
du total exact — c'est-à-dire du montant du règlement — souvent de **1 centime**.
`LIGNES_DIRECTES` contrôle la cohérence lignes ↔ règlement, voit l'écart et refuse. C'est un
**contrôle fiscal, pas une erreur de saisie** : il se reproduit sur toute vente au poids tant que
le mode d'arrondi n'est pas corrigé.

**Contournement magasin (débloquer la vente tout de suite)** : faire coïncider lignes et total —
remise d'un centime sur une ligne, ou ressaisie en collant au règlement.

**Fix de fond** : c'est le **paramétrage du mode d'arrondi** (ligne vs pied) côté Logic'S —
**Nicolas / Tom**. Détail côté automate dans `JET / Proc_Trace`.
`kb_search "ENCAISSEMENT_KO arrondi vente au poids"`.

## Symptôme : l'export comptable ne tombe pas sur la synthèse

**Situation typique** : l'export ventes généré depuis Logic'S Gestion ne correspond pas au total
mensuel ou annuel du rapport de caisse. L'écart vaut exactement le total TTC d'une (ou plusieurs)
journée(s) dont la clôture s'est mal passée : la ligne de clôture existe bien, mais les tickets
ne sont pas dans l'historique.

### Diagnostic (lecture seule — sans risque)

1. Sommer les règlements (espèces, cartes, chèques) de l'export, mois par mois.
2. Comparer aux totaux de la synthèse PDF. L'écart donne le montant de la ou des journées
   manquantes.
3. Lister les dates présentes dans l'export et repérer les jours ouvrés absents (attention aux
   jours de fermeture habituels du client).
4. Confirmer côté caisse en lisant la table des clôtures : la ligne existe, avec son numéro, son
   total, sa plage de numéros de tickets — et ce total correspond à l'écart constaté.

À ce stade on sait **exactement** ce qui manque, et on peut l'annoncer au client.

### Réparation — ce n'est pas du ressort du technicien

La suite (vérifier les archives de sauvegarde, contrôler qu'elles contiennent bien la bonne
plage de tickets, réinjecter dans l'historique, ou construire des écritures de synthèse quand
les sauvegardes ne sont pas exploitables) est une **procédure encadrée** avec des pièges à chaque
étape, et elle **dépend du fait que le client soit certifié NF-525 ou non**.

Procédure de référence : `kb_search "recuperer journee Z manquante archives Histo"`.
Exécutant qualifié : l'agent `logics-bases-clients` (repo `logics`), ou Nicolas.

Ce que le technicien apporte : le **diagnostic chiffré** ci-dessus (quelles journées, quels
numéros de clôture, quel montant), qui est exactement ce dont l'exécutant a besoin pour agir.

## Symptôme : l'export comptable plante en erreur 70018

À distinguer du cas précédent : ici l'export **ne se génère pas du tout**, il plante sur
`70018 « La source de données n'est pas initialisée »` (sur `HNbEnr`). Ce n'est pas un écart de
totaux, c'est un crash — donc pas le même diagnostic.

**Cause** : l'export parcourt les archives Histo **mois par mois** (`MMYYYY_Caisse_*_Histo`). Si
un mois de la période demandée n'a **aucune archive Histo** (aucune clôture Z sur ce mois),
l'alias n'est jamais résolu et la lecture échoue. Contexte typique : **install neuve ou caisse
remise à zéro**, dont la période d'export couvre un mois sans la moindre vente clôturée.

**Diagnostic (lecture seule)** :

1. Pour chaque mois de la période, regarder `C:\ServeurHF\BDD\<BASE>\MMYYYY\` et la présence de
   `MMYYYY_Caisse_Ticket_Entete_Histo.fic`.
2. Le mois sans archive est celui qui fait planter l'itération.

**Fix technicien (immédiat)** : restreindre la période d'export aux seuls mois qui ont de vraies
ventes clôturées (au moins une clôture Z Histo). L'export passe alors.

**Fix de fond** : l'export devrait ignorer proprement un mois sans archive au lieu de crasher —
bug Logic'S Gestion, **Nicolas / Tom**. `kb_search "export compta 70018 archive Histo"`.

## Vérifier avant de conclure

Quelle que soit l'intervention, la clôture d'un dossier « comptable » se prouve :

1. Les totaux relus en base correspondent à ceux de la clôture.
2. Le client relance son export comptable et **le total tombe** sur la synthèse (à l'arrondi près).
3. La synthèse mensuelle et annuelle est inchangée.

Sans ces trois points, on ne dit pas que c'est réparé.

## Références NF-525 dans la KB

La KB contient le certificat, les synthèses d'exigences, les checklists d'audit et l'outil de
contrôle d'archive fiscale : `kb_search "NF-525 règles à respecter"`.
Pour un technicien, l'essentiel tient dans les cinq garde-fous en haut de ce fichier.
