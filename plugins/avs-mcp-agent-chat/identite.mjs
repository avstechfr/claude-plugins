// Identite d'un agent sur le chat : un nom par SESSION, parlant, et unique.
//
// Avant (v1) : le nom venait de `<repo>/.claude/agent-name`, fichier versionne a la
// racine du repo. Toutes les fenetres ouvertes sur `avs` s'appelaient donc `central`,
// et on ne pouvait s'adresser a personne. Le fallback anti-collision `<repo>-<pid>`
// n'entrait jamais en jeu puisque le fichier existe dans tous nos repos.
//
// Maintenant : le nom derive du SUJET en cours (pose automatiquement par les hooks du
// plugin avs-statusline), et l'unicite est verifiee contre les autres agents vivants.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REGISTRE = path.join(os.homedir(), ".avs", "agent-chat", "agents.json");
// Au-dela, une entree de registre est consideree morte (fenetre fermee sans menage).
const PEREMPTION_MS = 6 * 60 * 60 * 1000;

export function slugify(s, max = 28) {
  return (
    String(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "agent"
  );
}

export function sessionId() {
  return process.env.CLAUDE_CODE_SESSION_ID?.trim() || null;
}

/** Sujet AVS de CETTE session, ecrit par les hooks de avs-statusline. */
export function sujetCourant() {
  const sid = sessionId();
  if (!sid) return null;
  try {
    const t = fs
      .readFileSync(path.join(os.homedir(), ".claude", "sujets", `session-${sid}.txt`), "utf8")
      .trim();
    if (!t) return null;
    const m = t.match(/^#(\d+)\s+(.*)$/);
    return m ? { numero: Number(m[1]), titre: m[2].trim(), brut: t } : { numero: null, titre: t, brut: t };
  } catch {
    return null;
  }
}

function repoTop() {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/** Mots porteurs de sens d'un titre de sujet : on jette les mots outils et les lieux
 *  entre parentheses pour obtenir "balances-helmac" plutot que "balances-helmac-linux-gmb". */
const VIDES = new Set([
  "le", "la", "les", "des", "du", "de", "un", "une", "et", "ou", "pour", "sur", "avec",
  "chez", "dans", "par", "aux", "au", "en", "installation", "probleme", "projet", "client",
]);

function nomDepuisSujet(sujet) {
  if (!sujet) return null;
  const titre = sujet.titre.replace(/\(.*?\)/g, " ").split(/[-–—:|]/)[0];
  const mots = titre
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9']+/)
    .filter((m) => m.length >= 3 && !VIDES.has(m))
    .slice(0, 2);
  if (mots.length === 0) return null;
  return slugify(mots.join("-"));
}

/** Base du nom, sans suffixe d'unicite.
 *  AGENT_NAME reste prioritaire : c'est l'identite fixe des agents dedies (serge, yves,
 *  ted), qu'on ne veut pas voir changer de nom au gre de leurs sujets. */
export function baseNom() {
  const env = process.env.AGENT_NAME?.trim();
  if (env) return { base: slugify(env), source: "env:AGENT_NAME" };

  const parSujet = nomDepuisSujet(sujetCourant());
  if (parSujet) return { base: parSujet, source: "sujet" };

  const top = repoTop();
  if (top) return { base: slugify(path.basename(top)), source: "repo" };
  return { base: slugify(path.basename(process.cwd())), source: "cwd" };
}

function lireRegistre() {
  try {
    const r = JSON.parse(fs.readFileSync(REGISTRE, "utf8"));
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

function ecrireRegistre(r) {
  try {
    fs.mkdirSync(path.dirname(REGISTRE), { recursive: true });
    fs.writeFileSync(REGISTRE, JSON.stringify(r, null, 2), "utf8");
  } catch {}
}

function vivant(entree) {
  if (!entree || Date.now() - (entree.ts || 0) > PEREMPTION_MS) return false;
  // Meme machine : le pid tranche tout de suite, sans attendre la peremption.
  if (entree.host === os.hostname() && entree.pid) {
    try {
      process.kill(entree.pid, 0);
    } catch {
      return false;
    }
  }
  return true;
}

/** Nom definitif de cet agent.
 *
 *  `occupesDistants` : noms vus recemment sur le chat (autres machines), que le
 *  registre local ne connait pas. Une collision cede le pas au premier arrive :
 *  balances-helmac, puis balances-helmac-2, -3...
 *
 *  Le nom reste revisable tant qu'aucun message n'a ete envoye sous ce nom (le sujet
 *  peut n'etre connu que quelques secondes apres l'ouverture de la fenetre) ; `figer`
 *  le verrouille des le premier envoi, pour qu'on puisse s'adresser a lui de facon
 *  stable. */
export function resoudreNom({ occupesDistants = [], figer = false } = {}) {
  const sid = sessionId();
  const registre = lireRegistre();

  // Menage : entrees mortes.
  for (const [nom, e] of Object.entries(registre)) {
    if (!vivant(e)) delete registre[nom];
  }

  const miennes = Object.entries(registre).filter(([, e]) => sid && e.session === sid);
  const dejaFige = miennes.find(([, e]) => e.fige);
  if (dejaFige) return { nom: dejaFige[0], ...baseNom(), fige: true };

  const { base, source } = baseNom();
  const pris = new Set([
    ...Object.keys(registre).filter((n) => !sid || registre[n].session !== sid),
    ...occupesDistants.filter((n) => n && (!sid || !miennes.some(([m]) => m === n))),
  ]);

  let nom = base;
  for (let i = 2; pris.has(nom); i++) nom = `${base}-${i}`;

  // L'ancien nom de cette session (sujet encore inconnu au demarrage) laisse la place.
  for (const [ancien] of miennes) if (ancien !== nom) delete registre[ancien];

  registre[nom] = {
    session: sid,
    pid: process.pid,
    host: os.hostname(),
    ts: Date.now(),
    fige: figer,
    sujet: sujetCourant()?.brut || null,
  };
  ecrireRegistre(registre);
  return { nom, base, source, fige: figer };
}

/** Agents vivants connus localement (registre de cette machine). */
export function agentsLocaux() {
  const r = lireRegistre();
  return Object.entries(r)
    .filter(([, e]) => vivant(e))
    .map(([nom, e]) => ({
      nom,
      sujet: e.sujet,
      host: e.host,
      session: e.session,
      vuIlYaMin: Math.round((Date.now() - e.ts) / 60000),
    }));
}
