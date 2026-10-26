// Identite d'un agent sur le chat : un nom par SESSION, parlant, unique, et STABLE.
//
// Avant (v1) : le nom venait de `<repo>/.claude/agent-name`, fichier versionne a la
// racine du repo. Toutes les fenetres ouvertes sur `avs` s'appelaient donc `central`,
// et on ne pouvait s'adresser a personne. Le fallback anti-collision `<repo>-<pid>`
// n'entrait jamais en jeu puisque le fichier existe dans tous nos repos.
//
// v2 : le nom derive du SUJET en cours (pose automatiquement par les hooks du plugin
// avs-statusline), et l'unicite est verifiee contre les autres agents vivants.
//
// v2.6.0 (15/10/2026) : la session 73429e2b a signe « problematiques-remontees », puis
// « clara », puis « nouveau-logo » dans la meme journee. Trois causes :
//   1. le nom fige ne vivait QUE dans le registre, dont l'entree meurt avec le pid du
//      serveur MCP (redemarrage, reprise de session) ou apres 6 h sans rafraichissement :
//      le nom suivant etait recalcule sur le sujet du moment ;
//   2. ce sujet pouvait venir d'un message d'un AUTRE agent (une notification du chat
//      contenant « #225 » avait pose le sujet du logo en source « humain ») ;
//   3. les hooks (process ephemeres) reecrivaient le registre avec leur propre pid.
// Desormais : le nom est ecrit dans `sessions/<sid>.json` des qu'il est fige (premier
// envoi) ou choisi (chat_rename) et n'en bouge plus ; il ne derive du sujet que si
// celui-ci a ete pose par l'humain ou par l'API intranet ; seul le serveur MCP ecrit
// le registre.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DOSSIER = path.join(os.homedir(), ".avs", "agent-chat");
const REGISTRE = path.join(DOSSIER, "agents.json");
// Nom fige ou choisi de chaque session : survit au serveur MCP (pid) et au registre.
const SESSIONS = path.join(DOSSIER, "sessions");
// Au-dela, une entree de registre est consideree morte (fenetre fermee sans menage).
const PEREMPTION_MS = 6 * 60 * 60 * 1000;
// Un nom fige reste reserve a sa session pendant ce delai apres son dernier usage :
// une fenetre inactive une nuit ne doit pas se faire prendre son nom au reveil.
const RESERVE_MS = 24 * 60 * 60 * 1000;
// Fichiers de session plus vieux : supprimes au passage.
const PURGE_SESSIONS_MS = 7 * 24 * 60 * 60 * 1000;
// Sources de sujet dont on accepte de deriver un nom (voir sujetPourNom).
const SOURCES_FIABLES = new Set(["humain", "api"]);

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
export function sujetCourant(sid = sessionId()) {
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

/** Sujet utilisable pour NOMMER l'agent : seulement s'il a ete pose par l'humain (numero
 *  ou titre tape) ou par l'API intranet. Le filet (Haiku qui lit la conversation, donc
 *  aussi les messages des autres agents) ne nomme personne. */
export function sujetPourNom(sid = sessionId()) {
  if (!sid) return null;
  try {
    const etat = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".claude", "sujets", `.etat-${sid}.json`), "utf8"),
    );
    if (!SOURCES_FIABLES.has(etat.source)) return null;
  } catch {
    return null;
  }
  return sujetCourant(sid);
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

export function nomDepuisSujet(sujet) {
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

  const parSujet = nomDepuisSujet(sujetPourNom());
  if (parSujet) return { base: parSujet, source: "sujet" };

  const top = repoTop();
  if (top) return { base: slugify(path.basename(top)), source: "repo" };
  return { base: slugify(path.basename(process.cwd())), source: "cwd" };
}

// --- Fichier de session : le nom qui ne bouge plus -----------------------------------

const fichierSession = (sid) => path.join(SESSIONS, `${slugify(sid, 64)}.json`);

export function lireSession(sid = sessionId()) {
  if (!sid) return null;
  try {
    const s = JSON.parse(fs.readFileSync(fichierSession(sid), "utf8"));
    return s && s.nom ? s : null;
  } catch {
    return null;
  }
}

function ecrireSession(sid, donnees) {
  if (!sid) return;
  try {
    fs.mkdirSync(SESSIONS, { recursive: true });
    fs.writeFileSync(
      fichierSession(sid),
      JSON.stringify({ ...donnees, session: sid, host: os.hostname(), ts: Date.now() }, null, 2),
      "utf8",
    );
  } catch {}
}

/** Noms figes par les AUTRES sessions de ce poste dans les dernieres 24 h. Menage des
 *  fichiers de plus de 7 jours au passage. */
function nomsReserves(sid) {
  const noms = [];
  let fichiers = [];
  try {
    fichiers = fs.readdirSync(SESSIONS);
  } catch {
    return noms;
  }
  for (const f of fichiers) {
    if (!f.endsWith(".json")) continue;
    const chemin = path.join(SESSIONS, f);
    try {
      if (Date.now() - fs.statSync(chemin).mtimeMs > PURGE_SESSIONS_MS) {
        fs.unlinkSync(chemin);
        continue;
      }
      const s = JSON.parse(fs.readFileSync(chemin, "utf8"));
      if (s.session === sid || !s.nom) continue;
      if (Date.now() - (s.ts || 0) < RESERVE_MS) noms.push(s.nom);
    } catch {}
  }
  return noms;
}

// --- Registre des agents vivants du poste ---------------------------------------------

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
    } catch (e) {
      return e.code === "EPERM";
    }
  }
  return true;
}

function entree(sid, { fige, choisi }) {
  return {
    session: sid,
    pid: process.pid,
    host: os.hostname(),
    ts: Date.now(),
    fige,
    choisi,
    sujet: sujetCourant(sid)?.brut || null,
  };
}

/** Nom definitif de cet agent. A n'appeler QUE depuis le serveur MCP : il ecrit le
 *  registre avec le pid du process appelant (un hook ephemere y inscrirait un pid deja
 *  mort, et son entree disparaitrait au menage suivant). Les hooks lisent nomDeSession().
 *
 *  `occupesDistants` : noms vus recemment sur le chat (autres machines), que le
 *  registre local ne connait pas. Une collision cede le pas au premier arrive :
 *  balances-helmac, puis balances-helmac-2, -3...
 *
 *  Le nom reste revisable tant qu'aucun message n'a ete envoye sous ce nom (le sujet
 *  peut n'etre connu que quelques secondes apres l'ouverture de la fenetre) ; `figer`
 *  le verrouille des le premier envoi. Une fois fige (ou choisi par chat_rename), il
 *  est ecrit dans sessions/<sid>.json et ne change PLUS JAMAIS de lui-meme, meme si le
 *  serveur redemarre, si le registre l'a oublie ou si le sujet change. */
export function resoudreNom({ occupesDistants = [], figer = false } = {}) {
  const sid = sessionId();
  const registre = lireRegistre();

  // Menage : entrees mortes.
  for (const [nom, e] of Object.entries(registre)) {
    if (!vivant(e)) delete registre[nom];
  }

  const miennes = Object.entries(registre).filter(([, e]) => sid && e.session === sid);
  const session = lireSession(sid);
  const { base, source: sourceBase } = baseNom();
  let nom;
  let source;
  let fige;
  let choisi = false;

  if (session?.fige) {
    // Cas normal apres le premier envoi : le fichier de session fait foi.
    nom = session.nom;
    choisi = !!session.choisi;
    source = choisi ? "choisi" : session.source || "fige";
    fige = true;
  } else {
    const dejaFige = miennes.find(([, e]) => e.fige);
    if (dejaFige) {
      // Registre d'avant la v2.6.0 : on reprend le nom fige tel quel.
      nom = dejaFige[0];
      choisi = !!dejaFige[1].choisi;
      source = "fige";
      fige = true;
    } else {
      const pris = new Set([
        ...Object.keys(registre).filter((n) => !sid || registre[n].session !== sid),
        ...nomsReserves(sid),
        ...occupesDistants.filter((n) => n && (!sid || !miennes.some(([m]) => m === n))),
      ]);
      nom = base;
      for (let i = 2; pris.has(nom); i++) nom = `${base}-${i}`;
      source = sourceBase;
      fige = figer;
    }
  }

  // Les autres noms de cette session (provisoires) laissent la place.
  for (const [ancien] of miennes) if (ancien !== nom) delete registre[ancien];

  registre[nom] = entree(sid, { fige, choisi });
  ecrireRegistre(registre);
  if (fige && sid) {
    ecrireSession(sid, { nom, fige: true, choisi, source, anciens: session?.anciens || [] });
  }
  return { nom, base, source, fige, choisi };
}

/** chat_rename : pose un nom CHOISI pour cette session (par l'agent, ou par l'humain qui
 *  le lui demande). Il est fige aussitot et ecrit au registre, pour que la barre le
 *  montre tout de suite. Refuse un nom deja pris (registre local, noms reserves des
 *  autres sessions du poste, noms vus sur le chat ces 6 dernieres heures). */
export function renommer(voulu, { occupesDistants = [] } = {}) {
  const sid = sessionId();
  if (!sid) {
    throw new Error("session inconnue (CLAUDE_CODE_SESSION_ID absent) : impossible de memoriser le nom");
  }
  const nom = slugify(voulu, 32);
  if (nom === "agent" || nom.length < 3) {
    throw new Error("nom trop court ou vide : 3 caracteres au moins, lettres/chiffres/tirets (ex: generation-378)");
  }
  const registre = lireRegistre();
  for (const [n, e] of Object.entries(registre)) if (!vivant(e)) delete registre[n];
  const miennes = Object.entries(registre).filter(([, e]) => e.session === sid);
  const actuel = nomDeSession(sid);
  const session = lireSession(sid);
  if (nom === actuel.nom && actuel.choisi) return { ancien: actuel.nom, nom, inchange: true };

  // Anciens noms de la session : ils ont parle sur le chat, ce n'est pas une collision.
  const anciens = new Set([...(session?.anciens || []), ...miennes.map(([n]) => n)]);
  if (session?.nom) anciens.add(session.nom);
  const pris = new Set([
    ...Object.keys(registre).filter((n) => registre[n].session !== sid),
    ...nomsReserves(sid),
    ...occupesDistants.filter((n) => n && !anciens.has(n)),
  ]);
  if (pris.has(nom)) {
    let libre = `${nom}-2`;
    for (let i = 3; pris.has(libre); i++) libre = `${nom}-${i}`;
    throw new Error(`« ${nom} » est deja pris par un autre agent. Choisis un autre nom (par exemple « ${libre} »).`);
  }

  for (const [n] of miennes) delete registre[n];
  registre[nom] = entree(sid, { fige: true, choisi: true });
  ecrireRegistre(registre);
  anciens.delete(nom);
  ecrireSession(sid, { nom, fige: true, choisi: true, source: "choisi", anciens: [...anciens] });
  return { ancien: actuel.enregistre ? actuel.nom : null, nom, inchange: false };
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
      fige: !!e.fige,
      vuIlYaMin: Math.round((Date.now() - e.ts) / 60000),
    }));
}

/** Nom de la session `sid` SANS rien ecrire (hooks, surveillant de mentions).
 *
 *  Ordre : fichier de session (nom fige ou choisi, qui ne bouge plus), puis nom courant
 *  au registre (provisoire tant qu'aucun message n'est parti), puis la base calculee
 *  (`enregistre: false` : le serveur MCP n'a encore rien inscrit). Ne passe jamais par
 *  resoudreNom() : appele depuis un autre process que le serveur, il reecrirait le
 *  registre avec un pid ephemere. */
export function nomDeSession(sid = sessionId()) {
  const session = lireSession(sid);
  if (session?.fige) return { nom: session.nom, fige: true, choisi: !!session.choisi, enregistre: true };
  const registre = lireRegistre();
  const miennes = Object.entries(registre).filter(([, e]) => sid && e.session === sid);
  const fige = miennes.find(([, e]) => e.fige);
  if (fige) return { nom: fige[0], fige: true, choisi: !!fige[1].choisi, enregistre: true };
  if (miennes.length) {
    miennes.sort(([, a], [, b]) => (b.ts || 0) - (a.ts || 0));
    return { nom: miennes[0][0], fige: false, choisi: false, enregistre: true };
  }
  return { nom: baseNom().base, fige: false, choisi: false, enregistre: false };
}
