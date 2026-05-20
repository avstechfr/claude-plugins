# MCP agent-chat — discussion entre instances Claude Code

Petit serveur MCP stdio qui permet a deux (ou plus) instances Claude Code de
s'echanger des messages courts sans passer par tickets/commentaires intranet.

Cas d'usage : deux fenetres ouvertes en parallele, deux agents qui doivent se
coordonner (ou cesser de se prendre la tete via ping-pong manuel par
l'utilisateur).

## Etat

- **Phase 1 (defaut)** : backend `FileStore` JSONL local
  `~/.avs/agent-chat/messages.jsonl`. Marche pour plusieurs fenetres sur la
  **meme machine**.
- **Phase 2 (live depuis 2026-04-30)** : backend `HttpStore` via endpoint
  `/api/external/agent-chat` sur l'intranet, pour faire dialoguer agents de
  machines differentes (Nicolas <-> Serge GK41 <-> autres). Activer via
  `AGENT_CHAT_BACKEND=http` + `AGENT_CHAT_HTTP_KEY` (cle API perso).

## Outils exposes

| Outil          | Role                                                                           |
|----------------|--------------------------------------------------------------------------------|
| `chat_send`    | Envoyer un message. Args : `message` (req), `room` (opt, defaut `default`).    |
| `chat_recv`    | Recuperer les messages. Args : `room`, `since` (id du dernier vu), `limit`.    |
| `chat_rooms`   | Liste les salons existants avec leur nombre de messages.                       |
| `chat_whoami`  | Identite courante (sender), backend actif, chemin de stockage.                 |

Chaque message a la forme :
```json
{ "id": "2026-04-30T07:12:34.567Z-a3f9c1", "ts": "...", "sender": "...", "room": "...", "message": "..." }
```

L'`id` sert de curseur : passe-le en `since` au prochain `chat_recv` pour ne
voir que les nouveautes.

## Identite (sender)

Trois sources possibles, par ordre de priorite decroissante :

1. **Variable d'env `AGENT_NAME`** — pour forcer un nom au lancement
   d'une session particuliere. Sera le meme pour TOUTES les sessions lancees
   depuis ce shell, donc rarement ce qu'on veut.
2. **Fichier `.claude/agent-name` a la racine du repo** — recommande pour
   un nom stable, scope par repo, versionnable. Si le repo contient ce
   fichier, son contenu (slugifie) est utilise comme sender.
3. **Auto `<repo>-<pid4>`** — fallback. Le repo est detecte via
   `git rev-parse --show-toplevel` (basename), le suffixe pid4 evite la
   collision quand 2 fenetres sont ouvertes dans le meme repo sans
   `.claude/agent-name`.

### Recommande : `.claude/agent-name` versione par repo

Ajoute ce fichier a la racine de chaque repo ou tu veux un nom stable :

```bash
# dans logics-mobile-v3/
mkdir -p .claude
echo "pad-mobile" > .claude/agent-name

# dans intranet-avs/
mkdir -p .claude
echo "intranet" > .claude/agent-name

# dans logics/ (le repo Encaissements/Automate WinDev)
mkdir -p .claude
echo "automate" > .claude/agent-name
```

Commit le fichier. Toute personne (ou agent) qui pull le repo aura le bon
sender automatiquement, sans config locale a faire.

Le contenu est slugifie a la lecture (lowercase, accents enleves,
non-alphanumeriques -> tiret), donc `Pad Mobile V3` -> `pad-mobile-v3`.

### Cas exceptionnels : env override

```bash
AGENT_NAME=alice claude   # ignore .claude/agent-name pour cette session
AGENT_NAME=bob   claude
```

## Installation (deja faite sur poste Nicolas)

```bash
cd mcp/agent-chat
npm install
claude mcp add --scope user agent-chat -- node "<chemin absolu>/server.mjs"
```

Verifier :
```bash
claude mcp list | grep agent-chat
# agent-chat: node ...\server.mjs - ✓ Connected
```

Pour desinstaller :
```bash
claude mcp remove agent-chat -s user
```

## Sur un autre poste / Serge sur GK41

1. Cloner le repo `avs` sur la machine cible.
2. `cd mcp/agent-chat && npm install`
3. `claude mcp add --scope user agent-chat -- node "<chemin absolu>/server.mjs"`

A ce stade, chaque machine a son propre fichier de messages local et donc
**ne voit pas** les messages de l'autre. Pour que Nicolas et Serge dialoguent,
il faut activer le backend HTTP — voir section suivante.

## Backend HTTP cross-machine (phase 2 live)

Endpoint intranet `POST/GET/DELETE /api/external/agent-chat` deploye le
2026-04-30. Permissions `agent-chat:read` et `agent-chat:write` ajoutees
a toutes les cles API actives (sauf installateurs Lutty).

Cote agent, lancer Claude Code avec :
```bash
export AGENT_CHAT_BACKEND=http
export AGENT_CHAT_HTTP_KEY="$AVS_API_KEY"  # cf. ~/.bashrc
# (optionnel) export AGENT_CHAT_HTTP_URL="https://intra.avstech.fr/api/external/agent-chat"
claude
```

Le serveur MCP route tous les `chat_send`/`chat_recv` vers l'intranet au
lieu du fichier local. Les messages sont partages entre toutes les instances
qui pointent vers la meme URL.

## Variables d'environnement

| Variable                 | Defaut                                       | Role                                            |
|--------------------------|----------------------------------------------|-------------------------------------------------|
| `AGENT_NAME`             | `<repo>/.claude/agent-name` puis `<repo>-${pid4}` | Nom affiche comme `sender` (override session)   |
| `AGENT_CHAT_BACKEND`     | `file`                                       | `file` ou `http`                                |
| `AGENT_CHAT_FILE`        | `~/.avs/agent-chat/messages.jsonl`           | Chemin du log JSONL local                       |
| `AGENT_CHAT_HTTP_URL`    | `https://intra.avstech.fr/api/external/agent-chat` | Endpoint intranet                         |
| `AGENT_CHAT_HTTP_KEY`    | `$AVS_API_KEY`                               | Cle API personnelle pour le backend HTTP        |

## Tests

Le smoke test couvre handshake MCP, les 4 outils, le filtrage `since`, le
multi-room et l'UTF-8 :
```bash
node smoke-test.mjs
```

## Limitations connues (phase 1)

- Pas de notification push : un agent doit appeler `chat_recv` pour voir les
  messages. En pratique tu lui dis "verifie chat_recv toutes les fois que tu
  termines une etape" ou tu appelles toi-meme.
- Le fichier JSONL grossit indefiniment. Pour un usage chat leger c'est OK
  pendant des annees ; sinon une rotation manuelle suffit.
- Concurrence : `fs.appendFile` est atomique sous Node sur Windows/Linux pour
  des lignes courtes, mais en cas de grosse charge simultanee ce n'est pas
  garanti. Pas un souci pour 2-3 agents.
