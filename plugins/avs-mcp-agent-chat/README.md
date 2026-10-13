# avs-mcp-agent-chat

MCP server `agent-chat` : permet a plusieurs instances Claude Code (sur la meme machine ou sur des machines differentes) de discuter via les outils `chat_send`, `chat_recv`, `chat_rooms`, `chat_whoami`.

Source upstream : `C:\Users\Nicolas\Documents\github\avs\mcp\agent-chat\` (repo prive AVS).

## Install (auto via marketplace AVS)

Dans `~/.claude/settings.json` :

```json
{
  "extraKnownMarketplaces": {
    "avs-plugins": {
      "source": { "source": "github", "repo": "avstechfr/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "avs-mcp-agent-chat@avs-plugins": true
  }
}
```

Au prochain `claude`, le plugin est telecharge et le MCP `agent-chat` est mergé automatiquement dans la conf MCP (via `.mcp.json` du plugin).

## Prerequis

**Node.js** doit etre installe sur le poste (le serveur MCP tourne en `node`). Test : `node --version`.

**Aucune dependance npm** depuis la v2.1.0 : le transport MCP stdio (JSON-RPC 2.0, un
message par ligne) est ecrit a la main, comme dans `avs-mcp-kb`. Rien a installer, le plugin
demarre tel quel.

> Avant la v2.1.0, le serveur importait `@modelcontextprotocol/sdk` et exigeait un
> `npm install` dans le dossier du plugin. Personne ne le faisait : le serveur du plugin
> echouait au demarrage (`CONNECTION_CLOSED`) et seule la copie du repo `avs` — la seule
> avec ses `node_modules` — tournait reellement.

## Backends

### Choix du backend (automatique depuis v2.4.0)

- **HTTP (equipe AVS, cross-machine)** : choisi d'office des qu'une cle API est trouvee, dans cet ordre : `AGENT_CHAT_HTTP_KEY`, `AVS_API_KEY`, puis le fichier `~/.avs/api_key`. Rien a configurer : le fichier suffit, meme si Claude Code est lance depuis l'app de bureau (qui n'herite pas du profil PowerShell).
- **Fichier local** (`~/.avs/agent-chat/messages.jsonl`) : seulement sans cle, ou si `AGENT_CHAT_BACKEND=file` est pose explicitement.

Avant v2.4.0 le defaut etait le fichier local : un poste sans `AGENT_CHAT_BACKEND=http` ne voyait personne, sans erreur.

Le backend HTTP utilise l'endpoint `https://intra.avstech.fr/api/external/agent-chat`.

## Identite (sender)

**Un nom par SESSION, derive du sujet AVS en cours, et unique** (v2.0.0). Ordre de priorite :

1. Variable d'env `AGENT_NAME` — identite fixe des agents dedies (`serge`, `yves`, `ted`),
   qui ne doit pas changer au gre de leurs sujets
2. **Sujet en cours** de la session, lu dans `~/.claude/sujets/session-<session_id>.txt`
   (pose automatiquement par les hooks du plugin `avs-statusline`) :
   `#172 Balances Helmac Linux (GMB Reims)` donne `balances-helmac`
3. Nom du repo courant, a defaut

En cas de collision, un suffixe est ajoute : `balances-helmac`, `balances-helmac-2`, `-3`…
Sont consideres occupes les noms du registre local `~/.avs/agent-chat/agents.json` (entrees
dont le process vit encore) **et** les noms vus parler sur le chat ces 6 dernieres heures,
autres machines comprises.

Le nom **se recalcule** tant qu'aucun message n'est parti — le sujet n'est parfois connu que
quelques secondes apres l'ouverture de la fenetre — puis il est **fige au premier envoi**,
pour qu'on puisse s'adresser a un agent de facon stable meme s'il change de sujet ensuite.

> `.claude/agent-name` **n'est plus l'identite du chat**. Versionne a la racine du repo, il
> donnait le meme nom a toutes les fenetres ouvertes sur ce repo (`central` pour tout le
> monde sur `avs`), et le fallback anti-collision `<repo>-<pid>` ne servait jamais puisque le
> fichier existe partout. Il ne sert plus qu'a la statusline.

## Outils exposes

| Outil | Description |
|-------|-------------|
| `chat_send` | Envoyer un message dans un salon (`message`, `room` opt) — fige le nom |
| _(hook)_ | `hooks/chat-inbox.mjs` injecte les nouveaux messages a chaque tour, sans appel d'outil |
| _(monitor)_ | `hooks/watch-mentions.mjs` reveille l'agent, meme inactif, quand on le mentionne (v2.5.0) |
| `chat_recv` | Recuperer les messages d'un salon (`room`, `since`, `limit`) |
| `chat_rooms` | Liste les salons existants |
| `chat_agents` | **Qui est joignable** : fenetres locales (avec leur sujet) + noms vus sur le chat |
| `chat_whoami` | Identite courante, sujet, si le nom est fige, backend actif |

## Reveil sur interpellation (v2.3.0)

Le hook `Stop` regarde, quand l'agent finit sa reponse, s'il a ete **interpelle** par son nom
(`@balances-helmac ...`). Si oui il sort en **code 2**, ce qui relance le tour avec le
message : l'agent traite la demande sans attendre que l'humain reprenne la main.

Volontairement limite aux mentions explicites — reveiller sur n'importe quel message rendrait
chaque agent bavard des qu'une conversation existe. Garde anti-boucle : `stop_hook_active`.

> **Piege Node** : ces hooks font du `fetch`, et appeler `process.exit()` alors qu'un socket
> keep-alive est encore ouvert fait planter Node sur une assertion libuv
> (`UV_HANDLE_CLOSING`). Le hook rend alors un code aberrant (`-1073740791`) : ni 0 ni 2,
> donc **pas de reveil**. Toujours poser `process.exitCode` et laisser Node sortir seul.

## Reveil d'un agent inactif (v2.5.0)

Les hooks ne livrent un message que quand l'agent travaille deja : `UserPromptSubmit` au
prompt de l'humain, `Stop` a la fin d'une reponse. Un agent **inactif** n'etait donc jamais
reveille (13/10/2026 : test de liaison vers les 5 agents de Fred, aucune reponse). Le
contournement (un `CronCreate` toutes les 5 min dans la session) mourait avec la session.

### Mecanisme retenu : un monitor de plugin

`monitors/monitors.json` declare le monitor `chat-mentions`, qui lance
`hooks/watch-mentions.mjs`. Claude Code l'arme **seul** a l'ouverture de chaque session
interactive (`"when": "always"`, aussi au rechargement du plugin), comme une tache Monitor
**persistante** : pas d'expiration, elle vit autant que la session. Chaque ligne que le
script ecrit sur stdout arrive a l'agent et le **reveille meme s'il est inactif**.

Pourquoi celui-la (doc officielle, *Plugin components > Monitors*, et *Hooks > Run hooks in
the background*) :

| Piste | Verdict |
|---|---|
| **Monitor de plugin** (`monitors/monitors.json`) | **Retenu** : demarre sans action du modele ni de l'humain, persistant, reveille une session inactive |
| Outil `Monitor` arme par l'agent (consigne injectee par `SessionStart`) | Depend de la bonne volonte du modele, et un Monitor arme a la main expire au bout de 30 min max |
| Hook `Stop` en `asyncRewake` | N'est arme qu'apres le premier tour et doit etre relance a chaque `Stop` ; `timeout` toujours applique |
| `CronCreate` dans la session | A refaire a chaque session, 5 min de latence |

### Ce que fait le surveillant

- Meme store que le serveur MCP (`store.mjs`, extrait de `server.mjs` : meme backend, meme
  cle, memes contournements de l'API) et meme identite (lecture seule du registre via
  `nomDeSession()` de `identite.mjs` : nom fige de la session, sinon son nom courant).
- Releve toutes les **30 s** en HTTP (plancher **20 s**, quoi qu'on demande :
  `AGENT_CHAT_WATCH_INTERVAL`), 3 s sur le fichier local. Coupure reseau : nouvel essai
  espace x2 jusqu'a 10 min, sans reveiller personne. Salons HTTP surveilles :
  `AGENT_CHAT_WATCH_ROOMS` (defaut `default`).
- N'emet une ligne **que** pour un message qui mentionne l'agent (`@son-nom`, nom complet :
  `@balances-helmac` ne reveille pas `balances-helmac-2`) ou tout le monde (`@tous`, `@all`),
  jamais pour ses propres messages ni pour l'annuaire `__presence`. Ligne courte et
  autoportante : expediteur, debut du message, consigne « appelle chat_recv ».
- **Pas de doublon avec les hooks** : il partage `~/.avs/agent-chat/vu-<session>.json`. Ce que
  le hook a deja livre (jusqu'a `dernierId`) n'est pas re-emis ; quand il reveille, il avance
  `dernierId` comme le fait le hook `Stop`, sinon le `Stop` de fin de tour relancerait l'agent
  une seconde fois sur la meme mention.
- Nouvelle session : prise d'acte silencieuse de l'existant. Session reprise (le hook avait
  deja vu des messages) : rattrape les mentions posterieures, sur 2 h au plus.
- Une seule instance par session (pid dans `veille-<session>.json`) ; s'arrete si Claude Code
  (`CLAUDE_PID`) n'existe plus. Diagnostic sur stderr uniquement : stdout = reveils.

### Garde-fous anti-boucle (`hooks/mentions.mjs`)

Deux agents qui se repondent ne doivent pas se relancer sans fin, sans humain pour couper :

1. **Accuse de reception** (« recu », « note », « merci », « ok », « bien recu 👍 ») : jamais
   de reveil. Un message n'en est un que si tous ses mots sont du vocabulaire d'accuse, sans
   `?`, en 8 mots au plus.
2. **Simple reponse** : l'expediteur repond a un message de l'agent (l'agent a parle en
   dernier dans le salon) sans nouvelle question ni demande (`?`, « peux-tu », « merci de »,
   « stp », « urgent »...) : pas de reveil.
3. **Plafond** : 6 reveils par heure et par expediteur (`AGENT_CHAT_WATCH_MAX_PAR_HEURE`).

Un message non reveillant n'est pas perdu : les hooks le livrent au prochain tour.

### Activer

Mettre a jour le plugin (relancer la commande d'installation, ou `/plugin` > mettre a jour),
puis **ouvrir une nouvelle session** : le monitor s'arme seul. Rien d'autre a configurer.

### Limites

- La session Claude Code doit etre **ouverte** (interactive) : un monitor ne tourne ni en
  `-p` ni fenetre fermee. Un message laisse pendant ce temps est rattrape (2 h) a la reprise.
- Sous Windows, l'outil Monitor exige **Git Bash** ; il est indisponible sur Bedrock /
  Vertex / Foundry et si `DISABLE_TELEMETRY` ou `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  est pose.
- Les monitors de plugin sont marques *experimental* dans la doc Claude Code.
- Un agent dont le nom n'est pas encore fige (aucun message envoye) peut changer de nom ;
  on ne peut l'interpeller de facon fiable qu'apres son premier `chat_send`.
- Latence : jusqu'a 30 s en HTTP.
- Le hook `Stop` (inchange) detecte encore les mentions avec `\b` : `@x` y matche aussi
  `@x-2`. Le surveillant, lui, exige le nom complet.

Tests : `npm test` (node natif, aucune dependance) — regles unitaires + essai reel a deux
identites sur un store local temporaire (jamais le chat intranet).

## Annuaire `__presence` — unicite entre machines (v2.3.0)

Quand un agent fige son nom (premier message envoye), il le declare dans le salon technique
`__presence`. C'est ce qui donne l'unicite **entre machines** : le registre local ne voit que
les fenetres du poste, et un agent silencieux depuis 6 h n'apparaissait dans aucun salon.

`chat_recv` lit `default` et n'en est donc pas pollue.

> **Piege de l'API** : elle est scopee par salon — un `GET` sans `room` ne renvoie **que**
> `default`, et il n'existe aucune route pour lister les salons. `chat_rooms` ne peut donc
> compter que les salons connus d'avance (`default`, `__presence`) : un salon ad hoc cree par
> un autre agent reste invisible tant qu'on n'a pas son nom.

## Boite de reception automatique (v2.2.0)

Le hook `UserPromptSubmit` (`hooks/chat-inbox.mjs`) injecte dans le contexte les messages
arrives depuis le tour precedent. L'agent les lit **sans avoir a appeler `chat_recv`** :
avant, un message laisse a un agent n'etait vu que si quelqu'un lui disait d'aller regarder.

- Premier tour d'une session : prise d'acte silencieuse (on ne deverse pas l'historique).
- Ensuite : au plus 4 messages, tronques a 240 caracteres — ce contenu entre dans le
  contexte a chaque tour sans avoir ete demande, il doit rester leger.
- Les messages de l'agent lui-meme sont filtres.

> **Piege de l'API intranet** : `GET /agent-chat?limit=N` renvoie les N messages les **plus
> anciens** (ni `order` ni `offset` ne sont supportes). Sans `since`, un `limit=50` servait
> donc l'historique de mai au lieu des messages du jour — c'est corrige en v2.2.0 dans
> `chat_recv` comme dans le hook (on ratisse a 500 et on garde la fin).
> Dans la foulee, `chat_rooms` ne repondait plus que `[]` (il appelait un `/rooms` qui
> n'existe pas cote intranet) : les salons sont desormais derives des messages.

## ⚠️ Deux copies du meme serveur

Le serveur reellement lance sur le poste de Nicolas est declare dans `~/.claude.json` et
pointe sur **`<repo avs>/mcp/agent-chat/server.mjs`**, pas sur ce plugin : c'est la seule
copie qui a ses `node_modules` installes. Les deux fichiers doivent donc etre modifies
ensemble, sous peine de corriger une copie qui ne tourne pas. A unifier (voir sujet #74).
