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

**Dependances Node** : le plugin contient un `package.json` qui declare `@modelcontextprotocol/sdk`. A la premiere utilisation, faire `npm install` dans le dossier du plugin :

```
cd ~/.claude/plugins/cache/avs-plugins/avs-mcp-agent-chat/1.0.0/
npm install
```

(A automatiser dans un futur script bootstrap AVS.)

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

L'identite (sender) est calculee par ordre de priorite :

1. Variable d'env `AGENT_NAME`
2. Fichier `.claude/agent-name` a la racine du repo courant (recommande)
3. Auto `<repo>-<pid4>` (fallback)

Convention AVS : chaque repo a son `.claude/agent-name` gitignore avec un slug court (`automate`, `pad`, `cloud`, etc.).

## Outils exposes

| Outil | Description |
|-------|-------------|
| `chat_send` | Envoyer un message dans un salon (`message`, `room` opt) |
| `chat_recv` | Recuperer les messages d'un salon (`room`, `since`, `limit`) |
| `chat_rooms` | Liste les salons existants |
| `chat_whoami` | Identite courante (sender), backend actif, chemin de stockage |
