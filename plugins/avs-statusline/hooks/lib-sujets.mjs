// Briques communes aux hooks "sujet courant" de la statusline AVS.
//
// Ecrit en Node plutot qu'en bash+ps1 : `bash` n'est pas le meme programme selon
// les postes (sur celui de Nicolas, c'est WSL, qui ne sait pas lire un chemin
// C:\...), alors que `node` est deja requis par les MCP AVS et se comporte
// pareil partout. Un seul fichier, pas de dispatcher a maintenir en double.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SUJETS_DIR = path.join(os.homedir(), ".claude", "sujets");
const CACHE_FILE = path.join(SUJETS_DIR, ".cache-sujets.json");
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_V = 2;
const API = "https://intra.avstech.fr/api/external/sujets";
// L'API plafonne limit a 100 et REJETTE au-dela (400 "Too big"), il faut donc
// paginer a l'offset. Sans ca on ne voit que les 100 sujets les plus recents.
const PAGE = 100;
const MAX_PAGES = 10;
// Etats consideres comme clos (le reste est affichable) : la liste des statuts
// vivants bouge avec l'intranet (in_progress, reflexion, not_started, idee,
// en_cours...), on exclut donc plutot que d'inclure.
const CLOS = new Set(["termine", "completed", "cancelled", "archive"]);

/** Cle API AVS : env AVS_API_KEY, sinon ~/.avs/api_key (meme contrat que le MCP KB). */
export function apiKey() {
  if (process.env.AVS_API_KEY) return process.env.AVS_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), ".avs", "api_key"), "utf8").trim();
  } catch {
    return null;
  }
}

/** Ecrit le sujet de CETTE session. Jamais le fichier <repo-key>.txt, partage par
 *  toutes les fenetres ouvertes sur le repo : l'ecraser change la statusline des autres. */
export function ecrireSujet(sessionId, texte) {
  if (!sessionId || !texte) return false;
  fs.mkdirSync(SUJETS_DIR, { recursive: true });
  const f = path.join(SUJETS_DIR, `session-${sessionId}.txt`);
  // UTF-8 sans BOM : un BOM ferait afficher un caractere parasite en tete de ligne.
  fs.writeFileSync(f, texte.trim() + "\n", { encoding: "utf8" });
  return true;
}

export function lireSujet(sessionId) {
  try {
    const t = fs.readFileSync(path.join(SUJETS_DIR, `session-${sessionId}.txt`), "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Liste des sujets non termines, mise en cache 12 h (l'API met ~1 s a repondre,
 *  trop lent pour un hook qui tourne a chaque prompt). */
export async function listeSujets({ force = false } = {}) {
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      // CACHE_V : un cache ecrit par une version anterieure peut manquer d'un champ
      // (l'ajout de `id` a fait echouer la detection PostToolUse en silence pendant
      // 12 h). On prefere refaire l'appel que lire une forme perimee.
      if (c.v === CACHE_V && Date.now() - c.ts < CACHE_TTL_MS && Array.isArray(c.sujets)) {
        return c.sujets;
      }
    } catch {}
  }
  const key = apiKey();
  if (!key) return [];
  let sujets = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API}?limit=${PAGE}&offset=${page * PAGE}`;
      const rep = await fetch(url, { headers: { "X-API-Key": key } });
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const lot = (await rep.json()).sujets || [];
      for (const s of lot) {
        if (CLOS.has(s.status)) continue;
        // `id` sert au hook PostToolUse : les appels API portent le cuid, pas le numero.
        sujets.push({ id: s.id, number: s.number, title: s.title, status: s.status });
      }
      if (lot.length < PAGE) break;
    }
  } catch {
    // Reseau coupe / API en rade : on retombe sur le cache meme perime plutot que
    // de perdre l'affichage.
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")).sujets || [];
    } catch {
      return [];
    }
  }
  try {
    fs.mkdirSync(SUJETS_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ v: CACHE_V, ts: Date.now(), sujets }), "utf8");
  } catch {}
  return sujets;
}

/** "#133" -> "#133 Rhomeo Decoration". Numero inconnu au bataillon -> null. */
export async function formaterParNumero(num) {
  const n = parseInt(String(num).replace("#", ""), 10);
  if (!Number.isFinite(n)) return null;
  let sujets = await listeSujets();
  let s = sujets.find((x) => x.number === n);
  // Sujet cree apres le dernier remplissage du cache : on rafraichit une fois.
  if (!s) {
    sujets = await listeSujets({ force: true });
    s = sujets.find((x) => x.number === n);
  }
  return s ? `#${s.number} ${courtTitre(s.title)}` : null;
}

/** Les titres de sujets vont jusqu'a ~100 caracteres ("#172 Balances Helmac Linux
 *  (GMB Reims) - remontee ventes + sync catalogue Cloud/Balance + telemaintenance") :
 *  au-dela la statusline deborde et pousse les autres segments hors ecran. On coupe
 *  de preference sur un separateur pour garder une tete de titre lisible. */
export function courtTitre(titre, max = 42) {
  let t = String(titre || "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  const sep = Math.max(coupe.lastIndexOf(" - "), coupe.lastIndexOf(" ("), coupe.lastIndexOf(" : "));
  if (sep > max / 2) return coupe.slice(0, sep).trim();
  const espace = coupe.lastIndexOf(" ");
  return (espace > max / 2 ? coupe.slice(0, espace) : coupe).trim() + "…";
}
