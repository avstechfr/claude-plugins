#!/usr/bin/env node
// Verrous de sous-projet AVS — application automatique du process #74.
//
// La regle existait depuis longtemps : « acquerir un lock sur le sous-projet avant de
// modifier, le liberer apres le push ». Ecrite en prose dans un document, elle etait
// oubliee par tout le monde — y compris par l'agent qui a ecrit ce fichier, qui a
// modifie le repo avs pendant qu'un autre agent y travaillait sans prendre un seul lock.
// Le harnais l'applique donc a notre place.
//
// PreToolUse  : avant toute ecriture, verifier puis acquerir le verrou du sous-projet.
// PostToolUse : un `git push` reussi libere les verrous de la session.
// SessionEnd  : filet, on ne laisse jamais un verrou derriere soi.
//
// Principe directeur : EN CAS DE DOUTE, ON LAISSE PASSER. Un outil de coordination qui
// empeche de travailler parce que l'intranet ne repond pas serait pire que le probleme
// qu'il resout. On ne bloque que sur un conflit avere.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const API = "https://intra.avstech.fr/api/external/locks";
const ETAT_DIR = path.join(os.homedir(), ".avs", "locks");
// Au-dela, on revalide aupres de l'intranet qu'on tient toujours le verrou.
const REVALIDATION_MS = 5 * 60 * 1000;

// Sous-projets acceptes par l'intranet. La liste y est FERMEE : tout chemin hors de
// cette liste n'est pas verrouillable et passe sans controle (`balances/`, `mcp/`, et
// les autres repos que `avs` ne sont pas couverts a ce jour).
const PATHS_CONNUS = [
  "intranet/web",
  "intranet",
  "site",
  "serveurs",
  "Verification periodique balance/web",
  "Verification periodique balance/api",
  "Verification periodique balance",
  "n8n",
  "serge",
  "onboarding",
];

function cle() {
  if (process.env.AVS_API_KEY) return process.env.AVS_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), ".avs", "api_key"), "utf8").trim();
  } catch {
    return null;
  }
}

/** Nom de cet agent, tel qu'il apparait aussi sur le chat et dans la statusline.
 *  Indispensable : deux fenetres de la meme personne partagent le meme compte API,
 *  seul ce label permet de savoir si le verrou est le mien ou celui du voisin. */
function moi(sessionId) {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".avs", "agent-chat", "agents.json"), "utf8"),
    );
    const t = Object.entries(reg).find(([, e]) => e && e.session === sessionId);
    if (t) return t[0];
  } catch {}
  return `session-${String(sessionId || "?").slice(0, 8)}`;
}

/** Sous-projet verrouillable correspondant a un fichier, ou null. */
function sousProjet(fichier, cwd) {
  if (!fichier) return null;
  let abs = path.isAbsolute(fichier) ? fichier : path.resolve(cwd || process.cwd(), fichier);
  let racine;
  try {
    racine = execFileSync("git", ["-C", path.dirname(abs), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return null;
  }
  // Les verrous ne couvrent que le repo central.
  if (path.basename(racine) !== "avs") return null;
  const rel = path.relative(racine, abs).split(path.sep).join("/");
  // Le plus specifique d'abord : `intranet/web` avant `intranet`.
  return (
    PATHS_CONNUS.filter((p) => rel === p || rel.startsWith(p + "/")).sort(
      (a, b) => b.length - a.length,
    )[0] || null
  );
}

async function api(methode, corps) {
  const k = cle();
  if (!k) return null;
  const rep = await fetch(API, {
    method: methode,
    headers: { "X-API-Key": k, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
  return rep.json();
}

const etatFile = (sid) => path.join(ETAT_DIR, `${sid}.json`);
function lireEtat(sid) {
  try {
    return JSON.parse(fs.readFileSync(etatFile(sid), "utf8"));
  } catch {
    return { tenus: {} };
  }
}
function ecrireEtat(sid, e) {
  try {
    fs.mkdirSync(ETAT_DIR, { recursive: true });
    fs.writeFileSync(etatFile(sid), JSON.stringify(e), "utf8");
  } catch {}
}

async function liberer(sid, raison) {
  const etat = lireEtat(sid);
  const paths = Object.keys(etat.tenus || {});
  for (const p of paths) {
    try {
      await api("DELETE", { path: p });
    } catch {}
  }
  if (paths.length) {
    ecrireEtat(sid, { tenus: {}, dernier: { raison, ts: Date.now(), paths } });
  }
  return paths;
}

async function surEcriture(d) {
  const sp = sousProjet(d.tool_input?.file_path || d.tool_input?.notebook_path, d.cwd);
  if (!sp) return; // hors perimetre verrouillable : on ne gene pas

  const sid = d.session_id;
  const etat = lireEtat(sid);
  const dejaTenu = etat.tenus?.[sp];
  if (dejaTenu && Date.now() - dejaTenu < REVALIDATION_MS) return; // deja a moi, recemment verifie

  const label = moi(sid);
  let lock;
  try {
    // POST est idempotent cote intranet : si le verrou existe deja, il est RENVOYE tel
    // quel (avec son agentLabel d'origine) au lieu d'etre repris. C'est donc a nous de
    // comparer pour savoir si nous le tenons.
    lock = await api("POST", {
      path: sp,
      reason: `Travail en cours (${label})`,
      agentLabel: label,
    });
  } catch {
    return; // intranet injoignable : on laisse travailler
  }
  if (!lock) return;

  if (lock.agentLabel && lock.agentLabel !== label) {
    const depuis = lock.acquiredAt ? new Date(lock.acquiredAt).toLocaleString("fr-FR") : "?";
    process.stderr.write(
      `Verrou AVS : le sous-projet « ${sp} » est pris par « ${lock.agentLabel} » depuis ${depuis}.\n` +
        `Motif : ${lock.reason || "non precise"}\n` +
        "Ne force pas : travaille sur un autre sous-projet, ou demande a cet agent de liberer " +
        "(le verrou tombe a son push, ou a la fin de sa session).\n",
    );
    process.exitCode = 2; // 2 = l'ecriture est refusee, l'agent recoit ce texte
    return;
  }

  etat.tenus = { ...(etat.tenus || {}), [sp]: Date.now() };
  ecrireEtat(sid, etat);
}

async function surBash(d) {
  const cmd = String(d.tool_input?.command || "");
  if (!/\bgit\s+push\b/.test(cmd)) return;
  // Le process dit : liberer APRES commit + push. C'est ici, pas avant.
  await liberer(d.session_id, "git push");
}

const morceaux = [];
for await (const c of process.stdin) morceaux.push(c);
let d = {};
try {
  d = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
} catch {}

if (d.session_id) {
  try {
    const ev = d.hook_event_name || "";
    if (ev === "PreToolUse") await surEcriture(d);
    else if (ev === "PostToolUse") await surBash(d);
    else if (ev === "SessionEnd") await liberer(d.session_id, "fin de session");
  } catch {
    // Un verrou ne doit jamais casser une session.
  }
}
// process.exitCode et jamais process.exit() : couper le process pendant que `fetch` a
// encore un socket ouvert fait planter Node (assertion libuv) et rend un code aberrant.
if (process.exitCode === undefined) process.exitCode = 0;
