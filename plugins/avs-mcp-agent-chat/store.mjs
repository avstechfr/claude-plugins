// Stockage des messages du chat inter-agents : FileStore (local) ou HttpStore (intranet).
//
// Extrait de server.mjs en v2.5.0 pour que le surveillant de mentions
// (hooks/watch-mentions.mjs) lise EXACTEMENT le meme store que le serveur MCP : meme choix
// de backend, meme cle, meme fichier, memes contournements de l'API intranet.

import { promises as fs, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const HTTP_URL =
  process.env.AGENT_CHAT_HTTP_URL || "https://intra.avstech.fr/api/external/agent-chat";

// Cle : variables d'env, sinon ~/.avs/api_key (meme contrat que avs-mcp-kb et avs-locks).
// Le fichier compte : lance depuis l'app de bureau ou un autre terminal, Claude Code
// n'herite pas du profil PowerShell, et une cle posee la seule y etait invisible.
export const HTTP_KEY = (() => {
  const env = process.env.AGENT_CHAT_HTTP_KEY || process.env.AVS_API_KEY;
  if (env) return env.trim();
  try {
    return readFileSync(path.join(homedir(), ".avs", "api_key"), "utf8").trim() || null;
  } catch {
    return null;
  }
})();

// Backend : HTTP (partage entre machines) des qu'une cle est disponible, sauf choix
// explicite. Avant le 17/09/2026 le defaut etait "file" : un poste sans
// AGENT_CHAT_BACKEND=http tournait en local, sans erreur, et ne voyait personne.
export const BACKEND = (
  process.env.AGENT_CHAT_BACKEND || (HTTP_KEY ? "http" : "file")
).toLowerCase();

export const FILE_PATH =
  process.env.AGENT_CHAT_FILE || path.join(homedir(), ".avs", "agent-chat", "messages.jsonl");

function newId() {
  return `${new Date().toISOString()}-${randomBytes(3).toString("hex")}`;
}

export class FileStore {
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

export class HttpStore {
  constructor(url, key, { rooms = [] } = {}) {
    if (!key) {
      throw new Error("AGENT_CHAT_HTTP_KEY (ou AVS_API_KEY) requis pour le backend HTTP");
    }
    this.url = url.replace(/\/$/, "");
    this.key = key;
    // Salons connus d'avance (l'API ne sait pas les lister) : voir listRooms.
    this.rooms = rooms;
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
    for (const room of this.rooms) {
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

/** Store configure selon l'environnement (meme regle pour le serveur et le surveillant). */
export function creerStore({ rooms = [] } = {}) {
  return BACKEND === "http"
    ? new HttpStore(HTTP_URL, HTTP_KEY, { rooms })
    : new FileStore(FILE_PATH);
}
