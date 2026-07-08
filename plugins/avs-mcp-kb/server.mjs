#!/usr/bin/env node
// MCP server : base de connaissances AVS (intra.avstech.fr) comme outil natif.
// La KB est le cerveau partage des agents : kb_search avant d'agir, kb_log apres.
// Zero dependance (JSON-RPC stdio implemente en direct) : aucun npm install requis.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const BASE_URL = process.env.AVS_INTRANET_URL || "https://intra.avstech.fr";
const SECRET_RE = /(mot de passe|password|api[ _-]?key|token|secret|credential)\s*[:=]/i;

// --- Auth : AVS_API_KEY (env), sinon ~/.avs/api_key ---
function resolveApiKey() {
  if (process.env.AVS_API_KEY) return process.env.AVS_API_KEY.trim();
  const f = path.join(homedir(), ".avs", "api_key");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  return null;
}

// L'API intranet double-encode l'UTF-8 brut sur certains POST :
// on echappe tout non-ASCII en \uXXXX (JSON reste valide, transport 100% ASCII).
function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

async function api(method, route, body) {
  const key = resolveApiKey();
  if (!key) {
    throw new Error(
      "Cle API AVS introuvable. Definir AVS_API_KEY (env) ou ecrire la cle dans ~/.avs/api_key. " +
      "Ta cle personnelle : https://intra.avstech.fr/api-keys (ou vault, voir BOOTSTRAP.md)."
    );
  }
  const res = await fetch(`${BASE_URL}/api/external/${route}`, {
    method,
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : asciiJson(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    throw new Error(`API ${method} /${route} -> HTTP ${res.status} : ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// --- Tools ---

const TOOLS = [
  {
    name: "kb_search",
    description:
      "Interroge la base de connaissances AVS (recherche hybride semantique + full-text + fuzzy, graphe traverse). " +
      "A utiliser OBLIGATOIREMENT : au debut de toute tache AVS, des qu'un nom inconnu apparait (client, produit, serveur, outil), " +
      "AVANT de poser une question a l'utilisateur, avant de chercher sur le web, et face a une erreur inexpliquee. " +
      "Si le resultat ne suffit pas, reformuler avec d'autres mots-cles (2-3 essais).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Question ou mots-cles (le semantique comprend les reformulations)" },
        maxNodes: { type: "number", description: "Nombre max de noeuds (defaut 15)" },
        maxDepth: { type: "number", description: "Profondeur de traversee du graphe (defaut 2)" },
        types: { type: "array", items: { type: "string" }, description: "Filtre types : product, company, person, concept, decision, resource" },
        tags: { type: "array", items: { type: "string" }, description: "Filtre tags" },
      },
      required: ["query"],
    },
  },
  {
    name: "kb_get",
    description: "Lit un noeud KB complet par son id (contenu integral, la ou kb_search tronque a 200 caracteres).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Id du noeud (cuid)" } },
      required: ["id"],
    },
  },
  {
    name: "kb_save",
    description:
      "Cree ou met a jour un noeud KB. A utiliser apres toute action significative (deploiement, config, decision, info apprise de l'utilisateur) " +
      "et pour corriger un noeud contredit par la realite. Si nodeId est fourni : mise a jour, sinon creation. " +
      "IMPORTANT : contenu avec mot de passe/cle/token -> visibility 'admin' obligatoire.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Id du noeud a mettre a jour (omettre pour creer)" },
        title: { type: "string" },
        content: { type: "string", description: "Markdown" },
        type: { type: "string", description: "product | company | person | concept | decision | resource (defaut resource)" },
        tags: { type: "array", items: { type: "string" } },
        visibility: { type: "string", description: "public | restricted | admin (defaut public)" },
      },
      required: ["content"],
    },
  },
  {
    name: "kb_link",
    description: "Cree une relation entre deux noeuds KB. Toujours relier un noeud cree au graphe (un noeud orphelin est invisible en traversee).",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        targetId: { type: "string" },
        type: { type: "string", description: "related_to (defaut) | part_of | used_by | depends_on | documented_in | implements | supersedes" },
      },
      required: ["sourceId", "targetId"],
    },
  },
  {
    name: "kb_log",
    description:
      "Journalise une lecon apprise ou une action significative : cree un noeud resource ET le relie automatiquement au noeud le plus proche du graphe. " +
      "A utiliser quand un probleme est resolu (symptome, cause racine, solution) ou en fin d'intervention. " +
      "Ne documenter que le SURPRENANT ou CONTRE-INTUITIF, pas ce qui est deja dans le code.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre court et datable, ex: 'Fix X - piege Y (08/07/2026)'" },
        content: { type: "string", description: "Markdown : symptome, cause, solution, comment eviter" },
        tags: { type: "array", items: { type: "string" } },
        visibility: { type: "string", description: "public | restricted | admin (defaut public)" },
      },
      required: ["title", "content"],
    },
  },
];

function textResult(s) {
  return { content: [{ type: "text", text: s }] };
}

async function createNode({ title, content, type, tags, visibility }) {
  const wantedVis = visibility || "public";
  const node = await api("POST", "knowledge/nodes", {
    type: type || "resource",
    title,
    content,
    tags: tags || [],
    visibility: wantedVis,
  });
  const id = node.id || node.node?.id;
  // Bug connu : POST peut ignorer visibility -> verifier et corriger via PUT
  if (wantedVis !== "public" && id) {
    await api("PUT", `knowledge/nodes/${id}`, { visibility: wantedVis });
  }
  return id;
}

async function handleTool(name, args) {
  switch (name) {
    case "kb_search": {
      const res = await api("POST", "knowledge/context", {
        query: args.query,
        maxNodes: args.maxNodes || 15,
        maxDepth: args.maxDepth ?? 2,
        nodeTypes: args.types || [],
        topics: args.tags || [],
        includeEntities: true,
      });
      const ids = (res.nodes || []).map((n) => `- ${n.id} : ${n.title}`).join("\n");
      return textResult(
        `${res.markdown || "(vide)"}\n\n### Node ids (pour kb_get / kb_link)\n${ids || "(aucun)"}`
      );
    }
    case "kb_get": {
      const n = await api("GET", `knowledge/nodes/${args.id}`);
      const node = n.node || n;
      return textResult(
        `# ${node.title}\n\ntype: ${node.type} | visibility: ${node.visibility} | tags: ${(node.tags || []).join(", ")}\n\n${node.content || "(pas de contenu)"}`
      );
    }
    case "kb_save": {
      if (SECRET_RE.test(args.content || "") && (args.visibility || "public") === "public") {
        return textResult(
          "REFUSE : le contenu semble contenir un secret (mot de passe / cle / token) alors que visibility=public. " +
          "Relance avec visibility 'admin' (regle AVS), ou retire le secret du contenu (mets-le dans le vault)."
        );
      }
      if (args.nodeId) {
        const payload = {};
        for (const k of ["title", "content", "tags", "visibility", "type"]) {
          if (args[k] !== undefined) payload[k] = args[k];
        }
        await api("PUT", `knowledge/nodes/${args.nodeId}`, payload);
        return textResult(`Noeud ${args.nodeId} mis a jour.`);
      }
      if (!args.title) return textResult("title est requis pour creer un noeud.");
      const id = await createNode(args);
      return textResult(`Noeud cree : ${id}. Pense a le relier au graphe (kb_link) s'il est lie a un sujet existant.`);
    }
    case "kb_link": {
      await api("POST", "knowledge/edges", {
        sourceId: args.sourceId,
        targetId: args.targetId,
        type: args.type || "related_to",
      });
      return textResult(`Edge ${args.sourceId} -[${args.type || "related_to"}]-> ${args.targetId} cree.`);
    }
    case "kb_log": {
      if (SECRET_RE.test(args.content || "") && (args.visibility || "public") === "public") {
        return textResult(
          "REFUSE : le contenu semble contenir un secret alors que visibility=public. " +
          "Relance avec visibility 'admin' ou retire le secret."
        );
      }
      const id = await createNode({ ...args, type: "resource" });
      // Auto-maillage : relier au meilleur voisin semantique
      let linked = null;
      try {
        const ctx = await api("POST", "knowledge/context", {
          query: args.title,
          maxNodes: 5,
          maxDepth: 1,
          includeEntities: false,
        });
        const best = (ctx.nodes || []).find((n) => n.id !== id);
        if (best) {
          await api("POST", "knowledge/edges", { sourceId: id, targetId: best.id, type: "related_to" });
          linked = best.title;
        }
      } catch { /* le log reste valide meme sans maillage */ }
      return textResult(
        `Lecon/action journalisee : noeud ${id}` + (linked ? `, relie a "${linked}".` : " (aucun voisin trouve pour le maillage, pense a kb_link).")
      );
    }
    default:
      return textResult(`Outil inconnu : ${name}`);
  }
}

// --- Serveur : JSON-RPC 2.0 sur stdio, un message JSON par ligne (transport MCP stdio) ---

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: req.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "avs-kb", version: "1.0.0" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const { name, arguments: args } = req.params || {};
      try {
        return await handleTool(name, args || {});
      } catch (err) {
        return textResult(`Erreur ${name} : ${err.message}`);
      }
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
  try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined || req.id === null) return; // notification : rien a repondre
  try {
    const result = await handleRequest(req);
    send({ jsonrpc: "2.0", id: req.id, result });
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: err.code || -32603, message: err.message || String(err) },
    });
  }
});
// stdin ferme -> readline se ferme -> plus aucun handle actif, node sort naturellement
