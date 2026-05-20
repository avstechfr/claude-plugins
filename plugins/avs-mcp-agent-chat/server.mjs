#!/usr/bin/env node
// MCP server : chat inter-agents Claude Code.
// Backend pluggable : FileStore (par defaut) ou HttpStore (intranet, phase 2).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const DEFAULT_ROOM = "default";
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

// Priorite : AGENT_NAME env > <repo>/.claude/agent-name > <repo>-<pid4> auto.
// Le pid4 fallback evite la collision quand 2 fenetres sont ouvertes dans un
// repo qui n'a pas encore de .claude/agent-name versione.
const AGENT_NAME_FROM_FILE = detectAgentNameFromFile();
const AGENT_NAME =
  process.env.AGENT_NAME?.trim() ||
  (AGENT_NAME_FROM_FILE ? slugify(AGENT_NAME_FROM_FILE) : null) ||
  `${slugify(detectRepoName())}-${String(process.pid).slice(-4)}`;

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
    if (limit) params.set("limit", String(limit));
    const data = await this._req(`?${params.toString()}`, { method: "GET" });
    return Array.isArray(data) ? data : data.messages || [];
  }

  async listRooms() {
    // L'intranet n'expose pas (encore) /rooms ; on derive depuis un GET large.
    // Renvoie un best-effort vide si pas dispo, au lieu de planter.
    try {
      const data = await this._req("/rooms", { method: "GET" });
      return Array.isArray(data) ? data : data.rooms || [];
    } catch {
      return [];
    }
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
      "Retourne l'identite de cet agent telle que vue par les autres (sender). Utile pour debug ou pour annoncer ton arrivee.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  { name: "avs-agent-chat", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name === "chat_send") {
      const message = String(args.message || "").trim();
      if (!message) throw new Error("`message` est requis et non vide");
      const room = String(args.room || DEFAULT_ROOM);
      const stored = await store.append({ sender: AGENT_NAME, room, message });
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
      const senderSource = process.env.AGENT_NAME?.trim()
        ? "env:AGENT_NAME"
        : AGENT_NAME_FROM_FILE
          ? "file:.claude/agent-name"
          : "auto:<repo>-<pid4>";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sender: AGENT_NAME,
                senderSource,
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
});

const transport = new StdioServerTransport();
await server.connect(transport);
