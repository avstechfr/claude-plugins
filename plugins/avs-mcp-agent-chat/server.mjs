#!/usr/bin/env node
// MCP server : chat inter-agents Claude Code.
// Backend pluggable : FileStore (par defaut) ou HttpStore (intranet, phase 2).

// Transport MCP stdio ecrit a la main (JSON-RPC 2.0, un message par ligne), comme
// avs-mcp-kb : le plugin n'a ainsi AUCUNE dependance npm. Avec le SDK, il fallait un
// `npm install` dans le dossier du plugin — que personne ne faisait : le serveur du
// plugin ne demarrait pas (CONNECTION_CLOSED) et seule la copie du repo avs tournait.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resoudreNom, renommer, agentsLocaux, sujetCourant, sessionId } from "./identite.mjs";
import { BACKEND, HTTP_URL, FILE_PATH, creerStore } from "./store.mjs";
import { avecEntete } from "./hooks/mentions.mjs";

const DEFAULT_ROOM = "default";
// Salon technique ou chaque agent declare son nom : sert d'annuaire entre machines.
const PRESENCE_ROOM = "__presence";
const FENETRE_MS = 6 * 60 * 60 * 1000;

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

// Identite : voir identite.mjs. Un nom par SESSION, fige au premier envoi (ou choisi
// par chat_rename) et ecrit dans sessions/<sid>.json : il ne change plus ensuite.
// `.claude/agent-name` n'est plus l'identite et la statusline ne l'affiche plus.

// Backend et stores : voir store.mjs (partage avec le surveillant de mentions).
const store = creerStore({ rooms: [DEFAULT_ROOM, PRESENCE_ROOM] });

// Presence : « presence <machine> — <sujet> » (+ « (anciennement <nom>) » apres un
// chat_rename). Le tiret long est le separateur historique, garde pour relire les
// messages deja publies.
function textePresence(ancien) {
  const base = `presence ${hostname()} — ${sujetCourant()?.brut || "sans sujet"}`;
  return ancien ? `${base} (anciennement ${ancien})` : base;
}

function lirePresence(message) {
  const m = String(message || "").match(/^presence\s+(\S+)\s+[—-]\s+(.*?)(?:\s+\(anciennement\s+([a-z0-9_-]+)\))?\s*$/i);
  if (!m) return null;
  return { machine: m[1], sujet: m[2] === "sans sujet" ? null : m[2], ancien: m[3] || null };
}

/** Annuaire du chat : pour chaque nom vu ces 6 dernieres heures (autres machines
 *  comprises), sa machine et son sujet tels qu'il les a declares dans `__presence`,
 *  et quand il a parle pour la derniere fois. Best-effort : si le backend ne repond
 *  pas, annuaire vide (on se rabat sur le registre local). */
async function annuaireDistant() {
  // L'API est scopee par salon (sans `room`, elle ne renvoie que `default`) : il faut
  // donc interroger explicitement l'annuaire `__presence`. C'est lui qui donne l'unicite
  // entre machines, un agent silencieux depuis 6 h n'apparaissant pas dans `default`.
  const annuaire = new Map();
  const limite = Date.now() - FENETRE_MS;
  for (const room of [PRESENCE_ROOM, DEFAULT_ROOM]) {
    let messages = [];
    try {
      messages = await store.fetchSince({ room, limit: 200 });
    } catch {
      continue;
    }
    for (const m of messages) {
      if (!m.sender) continue;
      const ts = m.ts ? new Date(m.ts).getTime() : 0;
      if (ts && ts <= limite) continue;
      const a = annuaire.get(m.sender) || { nom: m.sender, machine: null, sujet: null, anciens: [], ts: 0 };
      if (room === PRESENCE_ROOM) {
        const p = lirePresence(m.message);
        if (p) {
          a.machine = p.machine;
          a.sujet = p.sujet;
          if (p.ancien && !a.anciens.includes(p.ancien)) a.anciens.push(p.ancien);
        }
      }
      a.ts = Math.max(a.ts, ts);
      annuaire.set(m.sender, a);
    }
  }
  return annuaire;
}

async function nomsDistantsRecents() {
  return [...(await annuaireDistant()).keys()];
}

/** Nom courant. Tant qu'aucun message n'est parti, il se recalcule (le sujet n'est
 *  parfois connu que quelques secondes apres l'ouverture de la fenetre) ; le premier
 *  envoi le fige, et il ne bouge plus (sauf chat_rename). */
async function nomCourant({ figer = false } = {}) {
  const occupesDistants = await nomsDistantsRecents();
  return resoudreNom({ occupesDistants, figer });
}

const CONSEIL_NOM =
  "Ton nom vient du dossier/repo, il ne dit pas sur quoi tu travailles et personne ne " +
  "pourra relier ce nom a ta fenetre. Choisis un nom parlant avec chat_rename " +
  "(ex: generation-378, glory-elci), sans attendre qu'on te le demande.";

const TOOLS = [
  {
    name: "chat_send",
    description:
      "Envoie un message a l'autre agent Claude Code (autre fenetre, autre machine). Utilise-le quand tu dois coordonner avec une autre instance qui travaille en parallele. L'autre agent verra ton message en appelant chat_recv. Ne signe PAS tes messages (pas de « — de X ») : une ligne « de <ton nom> » est ajoutee automatiquement en tete, et c'est ce nom-la qu'on utilise pour te repondre (@ton-nom). Le premier envoi fige ton nom pour toute la session.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Le contenu textuel du message (markdown OK), sans signature.",
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
    name: "chat_rename",
    description:
      "Change ton nom sur le chat pour un nom parlant (ce sur quoi tu travailles : generation-378, glory-elci...). A utiliser quand ton nom actuel ne dit rien (nom de repo comme « logics ») ou est faux, ou quand l'humain te demande de t'appeler autrement. Le nom est fige pour le reste de la session, affiche dans sa barre en bas de Claude Code, et le changement est annonce sur le chat (« X s'appelle desormais Y »). Refuse si le nom est deja pris.",
    inputSchema: {
      type: "object",
      properties: {
        nom: {
          type: "string",
          description: "Nouveau nom : court, en minuscules, mots separes par des tirets (3 a 32 caracteres).",
        },
      },
      required: ["nom"],
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
      "Retourne l'identite de cet agent telle que vue par les autres (sender), le sujet AVS en cours et si le nom est fige. Tant qu'aucun message n'est parti le nom est provisoire ; ensuite il ne change plus, sauf par chat_rename.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chat_agents",
    description:
      "Liste les agents joignables, un par nom, avec sa MACHINE et son SUJET : les fenetres ouvertes sur ce poste et les agents vus sur le chat ces 6 dernieres heures (autres machines comprises). A appeler AVANT d'ecrire a quelqu'un pour connaitre son nom exact, et pour dire a l'humain quelle fenetre est quel agent.",
    inputSchema: { type: "object", properties: {} },
  },
];

const texte = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

async function handleTool(name, args = {}) {
  try {
    if (name === "chat_send") {
      const message = String(args.message || "").trim();
      if (!message) throw new Error("`message` est requis et non vide");
      const room = String(args.room || DEFAULT_ROOM);
      const avant = await nomCourant();
      const { nom, source, choisi } = await nomCourant({ figer: true });
      // Presence : au moment ou le nom se fige, on le declare dans un salon dedie. C'est
      // ce qui donne l'unicite ENTRE MACHINES — le registre local ne voit que les
      // fenetres du poste, et un agent silencieux depuis 6 h n'apparaissait nulle part.
      // Salon separe pour que `chat_recv` (qui lit `default`) n'en soit pas pollue.
      if (!avant.fige) {
        try {
          await store.append({ sender: nom, room: PRESENCE_ROOM, message: textePresence() });
        } catch {}
      }
      const stored = await store.append({ sender: nom, room, message: avecEntete(message, nom) });
      const rep = { ok: true, id: stored.id, ts: stored.ts, sender: stored.sender, room: stored.room };
      if (!choisi && (source === "repo" || source === "cwd")) rep.conseil = CONSEIL_NOM;
      return texte(rep);
    }

    if (name === "chat_rename") {
      const distants = await nomsDistantsRecents();
      const { ancien, nom, inchange } = renommer(String(args.nom || ""), { occupesDistants: distants });
      if (!inchange) {
        try {
          await store.append({ sender: nom, room: PRESENCE_ROOM, message: textePresence(ancien) });
        } catch {}
        if (ancien && ancien !== nom) {
          const sujet = sujetCourant()?.brut;
          try {
            await store.append({
              sender: nom,
              room: DEFAULT_ROOM,
              message: avecEntete(
                `${ancien} s'appelle desormais ${nom} (machine ${hostname()}` +
                  (sujet ? `, sujet ${sujet}` : "") +
                  `). Ecrivez-moi a @${nom}.`,
                nom,
              ),
            });
          } catch {}
        }
      }
      return texte({ ok: true, sender: nom, ancien, inchange: !!inchange, fige: true });
    }

    if (name === "chat_recv") {
      const room = args.room ? String(args.room) : DEFAULT_ROOM;
      const since = args.since ? String(args.since) : undefined;
      const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const messages = await store.fetchSince({ room, since, limit });
      return texte({
        room,
        count: messages.length,
        lastId: messages.length ? messages[messages.length - 1].id : since || null,
        messages,
      });
    }

    if (name === "chat_rooms") {
      return texte({ rooms: await store.listRooms() });
    }

    if (name === "chat_whoami") {
      const { nom, source, fige, choisi } = await nomCourant();
      const sujet = sujetCourant();
      const rep = {
        sender: nom,
        senderSource: source,
        // Tant que c'est false, le nom peut encore bouger si le sujet se precise.
        fige,
        choisi,
        sujet: sujet?.brut || null,
        session: sessionId(),
        backend: BACKEND,
        file: BACKEND === "file" ? FILE_PATH : null,
        http: BACKEND === "http" ? HTTP_URL : null,
        pid: process.pid,
        hostname: hostname(),
      };
      if (!choisi && (source === "repo" || source === "cwd")) rep.conseil = CONSEIL_NOM;
      return texte(rep);
    }

    if (name === "chat_agents") {
      const annuaire = await annuaireDistant();
      const moi = (await nomCourant()).nom;
      const lignes = new Map();
      for (const a of annuaire.values()) {
        lignes.set(a.nom, {
          nom: a.nom,
          machine: a.machine,
          sujet: a.sujet,
          ici: a.machine === hostname(),
          vuIlYaMin: a.ts ? Math.round((Date.now() - a.ts) / 60000) : null,
          ...(a.anciens.length ? { anciensNoms: a.anciens } : {}),
        });
      }
      // Le registre local est plus frais que l'annuaire (sujet du moment, fenetre
      // ouverte meme silencieuse) : il complete et corrige.
      for (const l of agentsLocaux()) {
        const deja = lignes.get(l.nom) || {};
        lignes.set(l.nom, {
          ...deja,
          nom: l.nom,
          machine: l.host,
          sujet: l.sujet || deja.sujet || null,
          ici: l.host === hostname(),
          vuIlYaMin: Math.min(l.vuIlYaMin, deja.vuIlYaMin ?? Infinity),
          ...(l.fige ? {} : { provisoire: true }),
        });
      }
      const agents = [...lignes.values()]
        .map((a) => (a.nom === moi ? { ...a, moi: true } : a))
        .sort((a, b) => (a.vuIlYaMin ?? 1e9) - (b.vuIlYaMin ?? 1e9));
      return texte({
        moi,
        machine: hostname(),
        // Un agent silencieux depuis 6 h sur une autre machine n'y figure pas.
        agents,
      });
    }

    throw new Error(`Outil inconnu : ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Erreur ${name}: ${err.message || String(err)}` }],
    };
  }
}

// --- Presence au registre local ----------------------------------------------------
// La statusline lit le registre pour afficher 🤖 <nom>. Avant, seul un appel d'outil
// y inscrivait la session : la barre montrait un nom faux (repli `.claude/agent-name`)
// jusqu'au premier chat_*. On s'inscrit des le demarrage, puis on rafraichit
// regulierement (sinon l'entree d'une fenetre inactive perime au bout de 6 h). Les
// noms distants ne sont relus que toutes les 30 min : l'API est partagee.
let distantsCache = [];
let distantsTs = 0;
async function battement() {
  try {
    if (Date.now() - distantsTs > 30 * 60 * 1000) {
      distantsCache = await nomsDistantsRecents();
      distantsTs = Date.now();
    }
    resoudreNom({ occupesDistants: distantsCache });
  } catch {}
}
if (sessionId()) {
  setTimeout(battement, 2000).unref();
  setInterval(battement, 5 * 60 * 1000).unref();
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
