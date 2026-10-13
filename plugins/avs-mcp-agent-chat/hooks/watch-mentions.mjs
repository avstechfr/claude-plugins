#!/usr/bin/env node
// Surveillant de mentions du chat inter-agents (v2.5.0) — reveil d'un agent INACTIF.
//
// Les hooks UserPromptSubmit et Stop ne livrent un message que quand l'agent travaille
// deja (prompt de l'humain, fin de reponse). Un agent inactif n'etait donc jamais
// reveille : le 13/10/2026, aucun des 5 agents de Fred n'a repondu a un test de liaison.
//
// Ce script est declare comme MONITOR du plugin (monitors/monitors.json) : Claude Code le
// lance seul a l'ouverture de chaque session interactive et le garde pour toute la
// session ; CHAQUE LIGNE ecrite sur stdout reveille l'agent, meme inactif. D'ou la regle
// d'or : stdout = uniquement les lignes de reveil. Tout le reste (diagnostic, erreurs
// reseau) va sur stderr.
//
// Une ligne n'est emise QUE pour un message qui mentionne l'agent (`@son-nom`) ou tout le
// monde (`@tous`), jamais pour ses propres messages, et apres les garde-fous anti-boucle
// de mentions.mjs (accuses de reception, simple reponse, plafond par expediteur).
//
// Options (tests, lancement manuel) :
//   --session <id>    session a surveiller (defaut : CLAUDE_CODE_SESSION_ID)
//   --nom <nom>       force le nom (defaut : registre local, comme le serveur MCP)
//   --intervalle <s>  periode de releve (defaut 30 s en HTTP, plancher 20 s ; 3 s en local)
//   --duree <s>       s'arrete apres ce delai (defaut : jamais)
//   --une-fois        une seule releve puis sortie

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nomDeSession } from "../identite.mjs";
import { BACKEND, creerStore } from "../store.mjs";
import { decider, noterReveil, ligneReveil } from "./mentions.mjs";

// --- Parametres --------------------------------------------------------------------
const args = process.argv.slice(2);
function opt(nom) {
  const i = args.indexOf(`--${nom}`);
  return i === -1 ? undefined : args[i + 1];
}
const UNE_FOIS = args.includes("--une-fois");
const SID = opt("session") || process.env.CLAUDE_CODE_SESSION_ID?.trim() || null;
const NOM_FORCE = opt("nom") || null;
const DUREE_MS = Number(opt("duree") || 0) * 1000;

const HTTP = BACKEND === "http";
// HTTP : jamais en dessous de 20 s, quoi qu'on demande — l'API intranet est partagee par
// toute l'equipe, et chaque fenetre ouverte fait tourner son surveillant.
const PLANCHER_S = HTTP ? 20 : 1;
const INTERVALLE_MS =
  Math.max(Number(opt("intervalle") || process.env.AGENT_CHAT_WATCH_INTERVAL || (HTTP ? 30 : 3)), PLANCHER_S) * 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const MAX_PAR_HEURE = Math.max(Number(process.env.AGENT_CHAT_WATCH_MAX_PAR_HEURE || 6), 1);
// En HTTP l'API est scopee par salon (un GET sans room ne rend que `default`).
const SALONS_HTTP = (process.env.AGENT_CHAT_WATCH_ROOMS || "default")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Au demarrage d'une session REPRISE, on rattrape les mentions arrivees pendant que
// personne ne surveillait, mais pas l'histoire ancienne.
const RATTRAPAGE_MS = 2 * 60 * 60 * 1000;

const DOSSIER = path.join(os.homedir(), ".avs", "agent-chat");
const CLE = SID || `pid-${process.env.CLAUDE_PID || process.ppid}`;
// Etat partage avec hooks/chat-inbox.mjs (meme fichier, meme champ `dernierId`).
const FICHIER_VU = path.join(DOSSIER, `vu-${CLE}.json`);
// Etat propre au surveillant : curseurs par salon, journal des reveils (plafond), pid.
const FICHIER_VEILLE = path.join(DOSSIER, `veille-${CLE}.json`);

const journal = (msg) => process.stderr.write(`[watch-mentions] ${msg}\n`);

function lireJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}
function ecrireJson(f, v) {
  try {
    fs.mkdirSync(DOSSIER, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(v), "utf8");
  } catch {}
}
function vivant(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// --- Releve ------------------------------------------------------------------------
const store = creerStore();
// Salons deja lus par CE process (voir releve()).
const amorces = new Set();
let veille = {};

/** Messages recents, salon par salon (HTTP) ou tous salons confondus (fichier). */
async function releve() {
  const salons = HTTP ? SALONS_HTTP : [null];
  const lots = [];
  for (const room of salons) {
    const cleSalon = room || "*";
    // Curseur d'un precedent process : seulement apres la prise d'acte (sinon une
    // longue coupure ferait remonter des mentions perimees sans filtre d'age).
    const since = amorces.has(cleSalon) ? veille.curseurs[cleSalon] : undefined;
    let messages = await store.fetchSince({ room: room || undefined, since, limit: 200 });
    // Fichier sans `room` : on retire l'annuaire technique.
    messages = messages.filter((m) => m.room !== "__presence");
    // « Premiere releve » = ce process n'a encore jamais lu ce salon (un salon vide au
    // demarrage ne doit pas faire prendre le premier vrai message pour de l'historique).
    const premier = !amorces.has(cleSalon);
    amorces.add(cleSalon);
    if (messages.length) veille.curseurs[cleSalon] = messages[messages.length - 1].id;
    lots.push({ room, messages, premier });
  }
  return lots;
}

async function tour() {
  const nom = NOM_FORCE || nomDeSession(SID).nom;
  const lots = await releve();
  const maintenant = Date.now();
  const vu = lireJson(FICHIER_VU);
  const emis = [];

  for (const { messages, premier } of lots) {
    // Ce que le hook a deja livre : tout ce qui precede (ou egale) son `dernierId`.
    const iHook = vu.dernierId ? messages.findIndex((m) => m.id === vu.dernierId) : -1;
    messages.forEach((m, i) => {
      if (i <= iHook) return;
      // Premiere releve : nouvelle session (le hook n'a encore rien vu) -> simple prise
      // d'acte, comme le premier passage du hook ; session reprise -> on rattrape les
      // mentions posterieures a ce que le hook a livre, sur 2 h au plus.
      if (premier && (!vu.dernierId || !(m.ts && maintenant - new Date(m.ts).getTime() < RATTRAPAGE_MS))) return;
      const d = decider(m, {
        nom,
        historique: messages.slice(0, i),
        journal: veille.reveils,
        maintenant,
        maxParHeure: MAX_PAR_HEURE,
      });
      if (d.reveil) {
        noterReveil(veille.reveils, m.sender, maintenant);
        emis.push(m);
      } else if (d.raison !== "pas-mentionne" && d.raison !== "le-mien") {
        journal(`pas de reveil (${d.raison}) : ${m.sender} ${m.id}`);
      }
    });
    if (emis.length && messages.length) {
      // On partage l'etat du hook comme le fait le hook Stop quand il reveille : sans
      // ca, le Stop de fin de tour relancerait l'agent une seconde fois sur la meme
      // mention.
      const dernier = messages[messages.length - 1].id;
      ecrireJson(FICHIER_VU, { ...lireJson(FICHIER_VU), dernierId: dernier, ts: maintenant });
    }
  }

  ecrireJson(FICHIER_VEILLE, veille);
  // Une ligne par mention (au plus 3 par releve : au-dela, une ligne de synthese).
  for (const m of emis.slice(0, 3)) process.stdout.write(ligneReveil(m, nom) + "\n");
  if (emis.length > 3) {
    process.stdout.write(
      `[agent-chat] ${emis.length - 3} autre(s) message(s) t'interpellent -> appelle chat_recv.\n`,
    );
  }
}

async function boucle() {
  const debut = Date.now();
  let attente = INTERVALLE_MS;
  journal(`demarre (session ${CLE}, backend ${BACKEND}, toutes les ${INTERVALLE_MS / 1000} s)`);
  for (;;) {
    try {
      await tour();
      attente = INTERVALLE_MS;
    } catch (e) {
      // Coupure reseau, intranet en maintenance : on espace les essais (x2 jusqu'a
      // 10 min) au lieu de marteler l'API, et on ne reveille personne pour ca.
      attente = Math.min(attente * 2, BACKOFF_MAX_MS);
      journal(`releve en echec (${e.message || e}) : prochain essai dans ${Math.round(attente / 1000)} s`);
    }
    if (UNE_FOIS) break;
    if (DUREE_MS && Date.now() - debut >= DUREE_MS) break;
    // La session est fermee : on ne survit pas a Claude Code.
    if (process.env.CLAUDE_PID && !vivant(Number(process.env.CLAUDE_PID))) break;
    await new Promise((r) => setTimeout(r, attente));
  }
  if (!UNE_FOIS) {
    const v = lireJson(FICHIER_VEILLE);
    if (v.pid === process.pid) ecrireJson(FICHIER_VEILLE, { ...v, pid: null });
  }
  // process.exitCode, jamais process.exit() : voir le piege libuv dans chat-inbox.mjs.
  process.exitCode = 0;
}

// --- Une seule instance par session -------------------------------------------------
// Un rechargement du plugin ou un lancement manuel ne doit pas doubler les reveils.
veille = lireJson(FICHIER_VEILLE);
if (!UNE_FOIS && veille.pid && veille.pid !== process.pid && vivant(veille.pid)) {
  journal(`deja actif pour ${CLE} (pid ${veille.pid}) : sortie`);
  process.exitCode = 0;
} else {
  veille = { curseurs: {}, reveils: {}, ...veille, pid: UNE_FOIS ? veille.pid : process.pid };
  await boucle();
}
