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

### FileStore (defaut, local single-machine)

Sans variable d'env, les messages sont stockes dans `~/.avs/agent-chat/messages.jsonl`. Plusieurs fenetres Claude Code sur la **meme machine** peuvent se voir. Pas de cross-machine.

### HttpStore (cross-machine, equipe AVS)

Pour permettre la discussion entre instances de machines differentes, activer le backend HTTP via les variables d'env :

```bash
# ~/.bashrc ou equivalent
export AGENT_CHAT_BACKEND=http
export AGENT_CHAT_HTTP_KEY=<ta-cle-AVS_API_KEY>
```

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
| `chat_recv` | Recuperer les messages d'un salon (`room`, `since`, `limit`) |
| `chat_rooms` | Liste les salons existants |
| `chat_agents` | **Qui est joignable** : fenetres locales (avec leur sujet) + noms vus sur le chat |
| `chat_whoami` | Identite courante, sujet, si le nom est fige, backend actif |

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
