#!/usr/bin/env node
// MCP server : chat inter-agents Claude Code.
// Backend pluggable : FileStore (par defaut) ou HttpStore (intranet, phase 2).

// Transport MCP stdio ecrit a la main (JSON-RPC 2.0, un message par ligne), comme
// avs-mcp-kb : le plugin n'a ainsi AUCUNE dependance npm. Avec le SDK, il fallait un
// `npm install` dans le dossier du plugin — que personne ne faisait : le serveur du
// plugin ne demarrait pas (CONNECTION_CLOSED) et seule la copie du repo avs tournait.
import { createInterface } from "node:readline";
import { promises as fs, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resoudreNom, agentsLocaux, sujetCourant, sessionId } from "./identite.mjs";

const DEFAULT_ROOM = "default";
// Salon technique ou chaque agent declare son nom : sert d'annuaire entre machines.
const PRESENCE_ROOM = "__presence";

const VERSION = (() => {
  try {
    return JSON.parse(
      readFileSync(new URL("./.claude-plugin/plugin.json", import.meta.url), "utf8"),
    ).version;
  } catch {
    return "inconnue";
  }
})();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent";
}

function detectRepoTop() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
    return top || null;
  } catch {
    return null;
  }
}

function detectRepoName() {
  const top = detectRepoTop();
  if (top) return path.basename(top);
  return path.basename(process.cwd()) || "agent";
}

// Lit un nom d'agent stable, scope par repo, via <repo>/.claude/agent-name.
// Versionnable : un repo qui contient ce fichier est auto-nomme partout ou il est cloned.
function detectAgentNameFromFile() {
  const top = detectRepoTop();
  if (!top) return null;
  const filePath = path.join(top, ".claude", "agent-name");
  try {
    const content = readFileSync(filePath, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

// Identite : voir identite.mjs. Un nom par SESSION, derive du sujet en cours, rendu
// unique parmi les agents vivants. `.claude/agent-name` n'est plus l'identite (il est
// versionne par repo : toutes les fenetres ouvertes sur `avs` s'appelaient `central`),
// il ne sert plus qu'a l'affichage de la statusline.
const AGENT_NAME_FROM_FILE = detectAgentNameFromFile();

/** Noms actifs vus sur le chat dans les dernieres heures (autres machines comprises).
 *  Best-effort : si le backend ne repond pas, on se rabat sur le registre local. */
async function nomsDistantsRecents() {
  // L'API est scopee par salon (sans `room`, elle ne renvoie que `default`) : il faut
  // donc interroger explicitement l'annuaire `__presence`, ou chaque agent declare son
  // nom en se figeant. C'est lui qui donne l'unicite entre machines, un agent silencieux
  // depuis 6 h n'apparaissant pas dans `default`.
  const noms = new Set();
  const limite = Date.now() - 6 * 60 * 60 * 1000;
  for (const room of [DEFAULT_ROOM, PRESENCE_ROOM]) {
    try {
      const messages = await store.fetchSince({ room, limit: 200 });
      for (const m of messages) {
        if (!m.sender) continue;
        if (m.ts && new Date(m.ts).getTime() <= limite) continue;
        noms.add(m.sender);
      }
    } catch {}
  }
  return [...noms];
}

/** Nom courant. Tant qu'aucun message n'est parti, il se recalcule (le sujet n'est
 *  parfois connu que quelques secondes apres l'ouverture de la fenetre) ; le premier
 *  envoi le fige pour que l'adressage reste stable. */
async function nomCourant({ figer = false } = {}) {
  const occupesDistants = await nomsDistantsRecents();
  return resoudreNom({ occupesDistants, figer });
}

const BACKEND = (process.env.AGENT_CHAT_BACKEND || "file").toLowerCase();

const FILE_PATH =
  process.env.AGENT_CHAT_FILE ||
  path.join(homedir(), ".avs", "agent-chat", "messages.jsonl");

const HTTP_URL =
  process.env.AGENT_CHAT_HTTP_URL || "https://intra.avstech.fr/api/external/agent-chat";
const HTTP_KEY = process.env.AGENT_CHAT_HTTP_KEY || process.env.AVS_API_KEY;

function newId() {
  return `${new Date().toISOString()}-${randomBytes(3).toString("hex")}`;
}

class FileStore {
  constructor(filePath) {
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) {
      // touch
      fs.writeFile(filePath, "", "utf8").catch(() => {});
    }
  }

  async append({ sender, room, message }) {
    const msg = { id: newId(), ts: new Date().toISOString(), sender, room, message };
    await fs.appendFile(this.filePath, JSON.stringify(msg) + "\n", "utf8");
    return msg;
  }

  async _readAll() {
    let text;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    const out = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // ligne corrompue, on ignore
      }
    }
    return out;
  }

  async fetchSince({ room, since, limit }) {
    const all = await this._readAll();
    let filtered = all;
    if (room) filtered = filtered.filter((m) => m.room === room);
    if (since) filtered = filtered.filter((m) => m.id > since);
    if (limit && filtered.length > limit) {
      filtered = filtered.slice(filtered.length - limit);
    }
    return filtered;
  }

  async listRooms() {
    const all = await this._readAll();
    const counts = new Map();
    for (const m of all) {
      counts.set(m.room, (counts.get(m.room) || 0) + 1);
    }
    return [...counts.entries()].map(([room, count]) => ({ room, count }));
  }
}

class HttpStore {
  constructor(url, key) {
    if (!key) {
      throw new Error(
        "AGENT_CHAT_HTTP_KEY (ou AVS_API_KEY) requis pour le backend HTTP",
      );
    }
    this.url = url.replace(/\/$/, "");
    this.key = key;
  }

  async _req(path, init = {}) {
    const res = await fetch(this.url + path, {
      ...init,
      headers: {
        "X-API-Key": this.key,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} sur ${path}`);
    }
    return res.json();
  }

  async append({ sender, room, message }) {
    const body = JSON.stringify({ sender, room, message });
    // Le serveur intranet genere id/ts et renvoie le message canonique.
    return this._req("", { method: "POST", body });
  }

  async fetchSince({ room, since, limit }) {
    const params = new URLSearchParams();
    if (room) params.set("room", room);
    if (since) params.set("since", since);
    // PIEGE : l'intranet renvoie les `limit` messages les PLUS ANCIENS, pas les plus
    // recents (ni `order` ni `offset` ne sont supportes ; constate le 12/09/2026).
    // Sans `since`, un limit=50 servait donc l'historique de mai au lieu des messages
    // du jour. On ratisse large et on coupe la fin nous-memes.
    params.set("limit", since ? String(limit || 50) : "500");
    const data = await this._req(`?${params.toString()}`, { method: "GET" });
    const messages = Array.isArray(data) ? data : data.messages || [];
    return since ? messages : messages.slice(-(limit || 50));
  }

  async listRooms() {
    // L'intranet n'expose pas de /rooms : l'appeler renvoyait toujours [], ce qui faisait
    // croire qu'aucune conversation n'existait alors que `default` en contenait 140.
    // Il n'expose pas non plus la liste des salons : un GET sans `room` ne renvoie que
    // `default`. On ne peut donc compter que les salons qu'on connait deja — un salon
    // ad hoc cree par un autre agent reste invisible tant qu'on n'a pas son nom.
    const rooms = [];
    for (const room of [DEFAULT_ROOM, PRESENCE_ROOM]) {
      try {
        const data = await this._req(`?room=${encodeURIComponent(room)}&limit=500`, {
          method: "GET",
        });
        const messages = Array.isArray(data) ? data : data.messages || [];
        if (messages.length) rooms.push({ room, count: messages.length });
      } catch {}
    }
    return rooms;
  }
}

const store =
  BACKEND === "http"
    ? new HttpStore(HTTP_URL, HTTP_KEY)
    : new FileStore(FILE_PATH);

const TOOLS = [
  {
    name: "chat_send",
    description:
      "Envoie un message a l'autre agent Claude Code (autre fenetre, autre machine). Utilise-le quand tu dois coordonner avec une autre instance qui travaille en parallele. L'autre agent verra ton message en appelant chat_recv.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Le contenu textuel du message (markdown OK).",
        },
        room: {
          type: "string",
          description: `Salon optionnel pour scoper la conversation. Defaut: "${DEFAULT_ROOM}".`,
        },
      },
      required: ["message"],
    },
  },
  {
    name: "chat_recv",
    description:
      "Recupere les nouveaux messages laisses par d'autres agents. Passe `since` = l'id du dernier message que tu as deja vu pour n'avoir que les nouveautes. Sans since, retourne les derniers messages (limit par defaut 50). C'est ainsi que tu DOIS verifier ce que les autres agents t'ont dit.",
    inputSchema: {
      type: "object",
      properties: {
        room: {
          type: "string",
          description: `Salon a lire. Defaut: "${DEFAULT_ROOM}".`,
        },
        since: {
          type: "string",
          description:
            "Id du dernier message vu (recupere via le champ `id` d'un appel precedent). Tous les messages strictement posterieurs sont retournes.",
        },
        limit: {
          type: "number",
          description: `Nombre max de messages a retourner. Defaut ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
      },
    },
  },
  {
    name: "chat_rooms",
    description:
      "Liste les salons existants avec leur nombre de messages. Utile pour decouvrir si d'autres conversations sont en cours.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chat_whoami",
    description:
      "Retourne l'identite de cet agent telle que vue par les autres (sender), le sujet AVS en cours et si le nom est fige. Le nom est derive du sujet et rendu unique ; il peut encore changer tant qu'aucun message n'a ete envoye.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chat_agents",
    description:
      "Liste les agents joignables : les fenetres ouvertes sur cette machine (avec le sujet de chacune) et les noms vus parler sur le chat ces 6 dernieres heures. A appeler AVANT d'ecrire a quelqu'un, pour connaitre son nom exact.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleTool(name, args = {}) {
  try {
    if (name === "chat_send") {
      const message = String(args.message || "").trim();
      if (!message) throw new Error("`message` est requis et non vide");
      const room = String(args.room || DEFAULT_ROOM);
      const avant = await nomCourant();
      const { nom } = await nomCourant({ figer: true });
      // Presence : au moment ou le nom se fige, on le declare dans un salon dedie. C'est
      // ce qui donne l'unicite ENTRE MACHINES — le registre local ne voit que les
      // fenetres du poste, et un agent silencieux depuis 6 h n'apparaissait nulle part.
      // Salon separe pour que `chat_recv` (qui lit `default`) n'en soit pas pollue.
      if (!avant.fige) {
        try {
          await store.append({
            sender: nom,
            room: PRESENCE_ROOM,
            message: `presence ${hostname()} — ${sujetCourant()?.brut || "sans sujet"}`,
          });
        } catch {}
      }
      const stored = await store.append({ sender: nom, room, message });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                id: stored.id,
                ts: stored.ts,
                sender: stored.sender,
                room: stored.room,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "chat_recv") {
      const room = args.room ? String(args.room) : DEFAULT_ROOM;
      const since = args.since ? String(args.since) : undefined;
      const limit = Math.min(
        Math.max(Number(args.limit) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      );
      const messages = await store.fetchSince({ room, since, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                room,
                count: messages.length,
                lastId: messages.length ? messages[messages.length - 1].id : since || null,
                messages,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "chat_rooms") {
      const rooms = await store.listRooms();
      return {
        content: [{ type: "text", text: JSON.stringify({ rooms }, null, 2) }],
      };
    }

    if (name === "chat_whoami") {
      const { nom, source, fige } = await nomCourant();
      const sujet = sujetCourant();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sender: nom,
                senderSource: source,
                // Tant que c'est false, le nom peut encore bouger si le sujet se precise.
                fige,
                sujet: sujet?.brut || null,
                session: sessionId(),
                backend: BACKEND,
                file: BACKEND === "file" ? FILE_PATH : null,
                http: BACKEND === "http" ? HTTP_URL : null,
                pid: process.pid,
                hostname: hostname(),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "chat_agents") {
      const distants = await nomsDistantsRecents();
      const locaux = agentsLocaux();
      const connusEnLocal = new Set(locaux.map((a) => a.nom));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                // Fenetres ouvertes sur cette machine (registre local, avec leur sujet).
                locaux,
                // Noms vus parler sur le chat ces 6 dernieres heures, autres machines
                // comprises. Un agent silencieux depuis 6 h n'y figure pas.
                distants: distants.filter((n) => !connusEnLocal.has(n)),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    throw new Error(`Outil inconnu : ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Erreur ${name}: ${err.message || String(err)}`,
        },
      ],
    };
  }
}

// --- Serveur : JSON-RPC 2.0 sur stdio, un message JSON par ligne ---

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: req.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        // Version lue sur le disque : ecrite en dur, elle restait figee a une vieille
        // valeur et faisait croire qu'une autre copie du serveur etait chargee.
        serverInfo: { name: "avs-agent-chat", version: VERSION },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const { name, arguments: args } = req.params || {};
      return handleTool(name, args || {});
    }
    case "ping":
      return {};
    default:
      throw { code: -32601, message: `Methode inconnue : ${req.method}` };
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id === undefined || req.id === null) return; // notification : rien a repondre
  try {
    send({ jsonrpc: "2.0", id: req.id, result: await handleRequest(req) });
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: err.code || -32603, message: err.message || String(err) },
    });
  }
});
