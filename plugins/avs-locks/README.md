# avs-locks

Verrous de sous-projet AVS, appliques par le harnais. Deux agents (ou deux personnes) ne
peuvent plus modifier le meme sous-projet en meme temps sans le savoir.

## Ce que ca fait

| Moment | Comportement |
|---|---|
| Avant une ecriture (`Edit`, `Write`, `NotebookEdit`) | acquiert le verrou du sous-projet concerne ; **refuse l'ecriture** si un autre agent le tient |
| Apres un `git push` | libere les verrous de la session — c'est la regle du process : on libere apres commit + push |
| Fin de session | filet : libere ce qui resterait |

Le verrou est pose via `POST /api/external/locks` sur l'intranet, avec un `agentLabel` qui
reprend le **nom de l'agent** (le meme que sur le chat et dans la statusline).

> **Pourquoi `agentLabel` est indispensable** : toutes les fenetres d'une meme personne
> partagent le meme compte et la meme cle API. Sans ce label, impossible de distinguer
> « mon verrou » de « celui de la fenetre d'a cote ». Il vient du registre
> `~/.avs/agent-chat/agents.json` tenu par `avs-mcp-agent-chat`.

## Pourquoi un hook et pas une consigne

La regle existe depuis le process unifie (#74) : « acquerir un lock sur le sous-projet avant
de modifier, le liberer apres le push ». Ecrite en prose, elle etait oubliee par tout le
monde — y compris par l'agent qui a ecrit ce plugin, qui a modifie le repo `avs` pendant
qu'un autre agent y travaillait, sans prendre un seul verrou. Ce qui doit arriver a chaque
fois releve du harnais.

## En cas de doute, ca laisse passer

Un outil de coordination qui empeche de travailler serait pire que le probleme qu'il resout.
Le hook ne bloque que sur un **conflit avere** : intranet injoignable, cle absente, chemin
hors perimetre, verrou deja a soi — dans tous ces cas l'ecriture passe.

## Perimetre — limite connue

L'intranet n'accepte qu'une **liste fermee** de sous-projets, tous dans le repo `avs` :

```
intranet/web · intranet · site · serveurs · n8n · serge · onboarding
Verification periodique balance[/web|/api]
```

Tout le reste passe **sans verrou** : `balances/`, `mcp/`, `contrats/`, `marketing/`… et les
autres repos (`logics`, `logics-cloud`, `intranet-avs`). Elargir la couverture demande de
modifier la liste cote intranet (repo `intranet-avs`) — a faire quand le besoin se presentera,
en commencant par `balances/`.

## Debloquer une situation

```powershell
# qui tient quoi
Invoke-RestMethod -Uri "https://intra.avstech.fr/api/external/locks" -Headers @{ "X-API-Key" = $env:AVS_API_KEY }

# liberer a la main (le DELETE prend le path dans le CORPS, pas en query)
Invoke-RestMethod -Uri "https://intra.avstech.fr/api/external/locks" -Method DELETE `
  -Headers @{ "X-API-Key" = $env:AVS_API_KEY; "Content-Type" = "application/json" } `
  -Body '{"path":"site"}'
```

Il n'y a **pas de TTL** : un verrou survit a une fenetre fermee brutalement (le hook
`SessionEnd` ne passe pas). Si un verrou semble orphelin, verifier son `acquiredAt` et son
`agentLabel` avant de le liberer.
