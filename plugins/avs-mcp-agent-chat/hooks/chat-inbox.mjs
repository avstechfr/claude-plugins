#!/usr/bin/env node
// Hook "boite de reception" du chat inter-agents.
//
// Le defaut de fond du chat : rien ne pousse les messages. Un agent ne les voit que
// s'il pense a appeler chat_recv — donc en pratique jamais, sauf si l'humain le lui
// demande. Ecrire a un agent revenait a laisser un mot sur un bureau vide.
//
// Ce hook s'execute a chaque message de l'humain (UserPromptSubmit) et injecte dans le
// contexte les messages arrives depuis le tour precedent. L'agent les lit sans avoir
// rien a demander, et sans que ca coute un appel d'outil.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resoudreNom } from "../identite.mjs";

const DOSSIER = path.join(os.homedir(), ".avs", "agent-chat");
const FICHIER_LOCAL = process.env.AGENT_CHAT_FILE || path.join(DOSSIER, "messages.jsonl");
const HTTP_URL =
  process.env.AGENT_CHAT_HTTP_URL || "https://intra.avstech.fr/api/external/agent-chat";
// Volume injecte volontairement serre : ces messages entrent dans le contexte a chaque
// tour sans que personne ne les ait demandes. Un premier essai a 10 messages x 500
// caracteres remplissait l'ecran d'historique.
const MAX_INJECTES = 4;
const MAX_CARS = 240;

const vuFile = (sid) => path.join(DOSSIER, `vu-${sid}.json`);

function lireVu(sid) {
  try {
    return JSON.parse(fs.readFileSync(vuFile(sid), "utf8"));
  } catch {
    return {};
  }
}

function ecrireVu(sid, etat) {
  try {
    fs.mkdirSync(DOSSIER, { recursive: true });
    fs.writeFileSync(vuFile(sid), JSON.stringify(etat), "utf8");
  } catch {}
}

function cleApi() {
  if (process.env.AGENT_CHAT_HTTP_KEY) return process.env.AGENT_CHAT_HTTP_KEY.trim();
  if (process.env.AVS_API_KEY) return process.env.AVS_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), ".avs", "api_key"), "utf8").trim();
  } catch {
    return null;
  }
}

async function messagesDepuis(since) {
  // Meme choix de backend que le serveur MCP : HTTP si configure, fichier sinon.
  if ((process.env.AGENT_CHAT_BACKEND || (cleApi() ? "http" : "file")).toLowerCase() === "http") {
    const cle = cleApi();
    if (!cle) return [];
    // L'intranet renvoie les `limit` messages les PLUS ANCIENS (pas de `order` ni
    // d'`offset`) : sans `since`, un limit court sert l'historique du printemps. On
    // ratisse large et on garde la fin.
    const p = new URLSearchParams({ limit: "500" });
    if (since) p.set("since", since);
    const rep = await fetch(`${HTTP_URL}?${p}`, { headers: { "X-API-Key": cle } });
    if (!rep.ok) return [];
    const data = await rep.json();
    const messages = Array.isArray(data) ? data : data.messages || [];
    return since ? messages : messages.slice(-20);
  }
  try {
    const lignes = fs.readFileSync(FICHIER_LOCAL, "utf8").trim().split("\n");
    const tous = lignes.map((l) => JSON.parse(l));
    if (!since) return tous.slice(-50);
    const i = tous.findIndex((m) => m.id === since);
    return i === -1 ? tous.slice(-50) : tous.slice(i + 1);
  } catch {
    return [];
  }
}

const morceaux = [];
for await (const c of process.stdin) morceaux.push(c);
let d = {};
try {
  d = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
} catch {}

// NB : on sort en posant `process.exitCode`, jamais avec `process.exit()`. Appeler
// process.exit() alors que `fetch` a encore un socket keep-alive ouvert fait planter Node
// sur une assertion libuv (« UV_HANDLE_CLOSING »), et le hook rend alors un code de sortie
// aberrant — Claude Code n'y verrait ni 0 ni 2, donc jamais le reveil.
const sid = d.session_id;
if (!sid) {
  process.exitCode = 0;
} else {
  await main();
}

async function main() {

// --- Reveil (hook Stop) ---------------------------------------------------------
// L'injection au tour suivant ne suffit pas : si personne ne parle a l'agent, il ne
// repart jamais. Ici, quand il finit sa reponse, on regarde s'il a ete INTERPELLE
// (`@son-nom`) ; si oui on sort en code 2, ce qui relance le tour avec le message.
// Deliberement limite aux mentions explicites : reveiller sur tout message rendrait
// chaque agent bavard des qu'une conversation existe.
if ((d.hook_event_name || "") === "Stop") {
  if (d.stop_hook_active) return; // relance imbriquee : on s'arrete la
  try {
    const etat = lireVu(sid);
    const { nom } = resoudreNom({});
    const messages = await messagesDepuis(etat.dernierId);
    const pourMoi = messages.filter(
      (m) => m.sender && m.sender !== nom && new RegExp(`@${nom}\\b`, "i").test(String(m.message)),
    );
    if (pourMoi.length) {
      ecrireVu(sid, { ...etat, dernierId: messages[messages.length - 1].id, ts: Date.now() });
      const resume = pourMoi
        .slice(-2)
        .map((m) => `${m.sender} : ${String(m.message).replace(/\s+/g, " ").slice(0, MAX_CARS)}`)
        .join("\n");
      process.stderr.write(
        `Tu viens d'etre interpelle sur le chat inter-agents (tu es \`${nom}\`) :\n${resume}\n` +
          "Traite la demande si elle te concerne, puis reponds avec chat_send. " +
          "Si elle ne te concerne pas, dis-le en une ligne et arrete-toi.\n",
      );
      process.exitCode = 2; // 2 = relance le tour avec ce texte
      return;
    }
  } catch {}
  return;
}

  try {
    const etat = lireVu(sid);
    const messages = await messagesDepuis(etat.dernierId);
    // Premier passage d'une session : on prend acte de l'existant sans le deverser dans
    // le contexte — sinon l'agent recoit 50 messages d'historique sans rapport.
    const premierPassage = !etat.dernierId;
    if (messages.length) {
      ecrireVu(sid, { dernierId: messages[messages.length - 1].id, ts: Date.now() });
    }
    if (!premierPassage && messages.length) {
      const { nom } = resoudreNom({});
      const autres = messages.filter((m) => m.sender && m.sender !== nom).slice(-MAX_INJECTES);
      if (autres.length) {
        const lignes = autres.map((m) => {
          const texte = String(m.message).replace(/\s+/g, " ").trim();
          const coupe = texte.length > MAX_CARS ? texte.slice(0, MAX_CARS) + "… (tronque)" : texte;
          return `- [${m.room || "default"}] ${m.sender} : ${coupe}`;
        });
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: [
                `Messages recus sur le chat inter-agents depuis ton dernier tour (tu es \`${nom}\`) :`,
                ...lignes,
                "Reponds-y avec chat_send si c'est attendu de toi ; sinon ignore.",
              ].join("\n"),
            },
          }),
        );
      }
    }
  } catch {
    // Un hook qui echoue ne doit jamais gener la session.
  }
  process.exitCode = 0;
}
