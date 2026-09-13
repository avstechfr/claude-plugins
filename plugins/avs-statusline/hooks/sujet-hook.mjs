#!/usr/bin/env node
// Hook "sujet courant" de la statusline AVS — point d'entree unique des 4 evenements.
//
// Pourquoi un hook et pas une consigne CLAUDE.md : ecrire le fichier sujet etait
// demande a l'agent en prose. Resultat mesure le 12/09/2026 : ~15 sessions
// renseignees en 3 mois, et un fichier de repo fige au 17/07 qui affichait un
// sujet faux en permanence. Ce qui doit arriver a chaque fois est execute par le
// harnais, pas espere du modele.
//
// Ordre de confiance des signaux :
//   1. UserPromptSubmit — "#133" ou un titre reconnu dans ce que tape l'humain (verrouille)
//   2. PostToolUse      — l'agent appelle /api/external/sujets/<id|numero>
//   3. Stop             — filet : un Haiku choisit dans la liste des sujets ouverts
// Un signal fort n'est jamais ecrase par un signal faible dans la meme session.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { SUJETS_DIR, listeSujets, formaterParNumero, courtTitre, apiKey } from "./lib-sujets.mjs";

const MODELE_FILET = "claude-haiku-4-5-20251001";
const FILET_TIMEOUT_MS = 25_000;
const PURGE_APRES_MS = 7 * 24 * 60 * 60 * 1000;
// La barre doit dire sur quoi on travaille MAINTENANT, pas ce qu'on a ouvert ce matin.
// Un signal fort (numero cite, appel a l'API sujets) protege donc le sujet pendant une
// FENETRE, pas pour toute la session : passe ce delai, le filet a le droit de reviser.
const VERROU_MS = 30 * 60 * 1000;
// Cadence de revision du filet : au-dela, il revient voir si la conversation a derive.
const REVISION_MS = 20 * 60 * 1000;

// Garde anti-recursion : le filet relance `claude -p`, qui declencherait a son tour
// les hooks Stop. Le fils voit cette variable et sort immediatement.
if (process.env.AVS_SUJET_HOOK === "1") process.exit(0);

const etatFile = (sid) => path.join(SUJETS_DIR, `.etat-${sid}.json`);

function lireEtat(sid) {
  try {
    return JSON.parse(fs.readFileSync(etatFile(sid), "utf8"));
  } catch {
    return {};
  }
}

function ecrireEtat(sid, etat) {
  try {
    fs.mkdirSync(SUJETS_DIR, { recursive: true });
    fs.writeFileSync(etatFile(sid), JSON.stringify(etat), "utf8");
  } catch {}
}

/** Pose le sujet si la source est au moins aussi fiable que celle en place — ou si
 *  celle-ci a vieilli au-dela de VERROU_MS (un sujet cite il y a deux heures ne dit plus
 *  ce qu'on fait maintenant). */
function poser(sid, texte, source) {
  if (!sid || !texte) return false;
  const rang = { filet: 1, api: 2, humain: 3 };
  const etat = lireEtat(sid);
  if (etat.texte === texte) {
    // Meme sujet : on rafraichit l'horodatage, le travail est toujours en cours.
    ecrireEtat(sid, { ...etat, ts: Date.now() });
    return false;
  }
  const encoreFrais = Date.now() - (etat.ts || 0) < VERROU_MS;
  if (etat.source && encoreFrais && rang[source] < rang[etat.source]) return false;
  fs.mkdirSync(SUJETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SUJETS_DIR, `session-${sid}.txt`), texte.trim() + "\n", "utf8");
  ecrireEtat(sid, { ...etat, texte, source, ts: Date.now() });
  return true;
}

async function lireStdin() {
  const morceaux = [];
  for await (const c of process.stdin) morceaux.push(c);
  try {
    return JSON.parse(Buffer.concat(morceaux).toString("utf8"));
  } catch {
    return null;
  }
}

// --- 1. Ce que tape l'humain -------------------------------------------------

/** Reconnait "#133", "sujet 133", "on passe sur le 133". Pas un nombre nu : "il y a
 *  133 articles" ne doit pas changer de sujet. */
function numeroDansTexte(texte) {
  const m =
    texte.match(/#(\d{1,4})\b/) ||
    texte.match(/\bsujets?\s*(?:n[°o]\s*)?(\d{1,4})\b/i) ||
    texte.match(/\bdossiers?\s*(?:n[°o]\s*)?(\d{1,4})\b/i);
  return m ? m[1] : null;
}

/** Titre de sujet cite en toutes lettres ("on bosse sur Rhomeo"). Exige au moins deux
 *  mots significatifs communs pour eviter qu'un "site" ou "caisse" isole ne matche
 *  la moitie du portefeuille. */
function parTitre(texte, sujets) {
  const mots = (s) =>
    new Set(
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9']+/)
        .filter((m) => m.length >= 4)
    );
  const dits = mots(texte);
  if (dits.size === 0) return null;
  let meilleur = null;
  for (const s of sujets) {
    const cibles = mots(s.title);
    let score = 0;
    for (const m of cibles) if (dits.has(m)) score++;
    if (score >= 2 && (!meilleur || score > meilleur.score)) meilleur = { s, score };
  }
  return meilleur ? `#${meilleur.s.number} ${courtTitre(meilleur.s.title)}` : null;
}

async function surPrompt(d) {
  const texte = d.prompt || "";
  const num = numeroDansTexte(texte);
  if (num) {
    const t = await formaterParNumero(num);
    if (t) return poser(d.session_id, t, "humain");
  }
  const t = parTitre(texte, await listeSujets());
  if (t) return poser(d.session_id, t, "humain");
  return false;
}

// --- 2. Ce que fait l'agent --------------------------------------------------

/** L'agent qui travaille un sujet finit toujours par taper son API (lecture du
 *  sujet, ajout d'une note ou d'une etape). L'URL porte le cuid, d'ou la table
 *  id -> sujet. */
async function surOutil(d) {
  const brut = JSON.stringify(d.tool_input || {});
  if (!brut.includes("/sujets/")) return false;
  const sujets = await listeSujets();
  const mId = brut.match(/\/sujets\/([a-z0-9]{20,})/i);
  if (mId) {
    const s = sujets.find((x) => x.id === mId[1]);
    if (s) return poser(d.session_id, `#${s.number} ${courtTitre(s.title)}`, "api");
  }
  const mNum = brut.match(/\/sujets\/(\d{1,4})\b/);
  if (mNum) {
    const t = await formaterParNumero(mNum[1]);
    if (t) return poser(d.session_id, t, "api");
  }
  return false;
}

// --- 3. Le filet -------------------------------------------------------------

/** Derniers messages utilisateur du transcript (JSONL). On ne prend que ce que
 *  l'humain a ecrit : les reponses de l'agent sont longues et brouillent le signal. */
function derniersMessagesUtilisateur(transcriptPath, n = 8) {
  try {
    const lignes = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");
    const out = [];
    for (let i = lignes.length - 1; i >= 0 && out.length < n; i--) {
      let e;
      try {
        e = JSON.parse(lignes[i]);
      } catch {
        continue;
      }
      if (e.type !== "user" || !e.message) continue;
      const c = e.message.content;
      const texte = typeof c === "string" ? c : (c || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      // Les retours d'outil arrivent aussi en role user : on les saute.
      if (!texte || texte.startsWith("<") || texte.length < 8) continue;
      out.unshift(texte.slice(0, 500));
    }
    return out;
  } catch {
    return [];
  }
}

function claudeP(prompt) {
  return new Promise((resolve) => {
    let sortie = "";
    let fini = false;
    const fin = (v) => {
      if (!fini) {
        fini = true;
        resolve(v);
      }
    };
    let p;
    try {
      // Prompt par stdin, jamais en argument : il est multiligne et contient la liste
      // des sujets. Et surtout pas de `shell: true` — cmd.exe massacre les sauts de
      // ligne et Node 24 le deprecie (DEP0190). `claude` est un vrai binaire, il se
      // lance directement.
      p = spawn("claude", ["-p", "--model", MODELE_FILET], {
        env: { ...process.env, AVS_SUJET_HOOK: "1" },
        stdio: ["pipe", "pipe", "ignore"],
      });
      p.stdin.end(prompt, "utf8");
    } catch {
      return fin(null);
    }
    const minuteur = setTimeout(() => {
      try {
        p.kill();
      } catch {}
      fin(null);
    }, FILET_TIMEOUT_MS);
    p.stdout.on("data", (c) => (sortie += c.toString()));
    p.on("error", () => {
      clearTimeout(minuteur);
      fin(null);
    });
    p.on("close", () => {
      clearTimeout(minuteur);
      fin(sortie.trim());
    });
  });
}

async function surStop(d) {
  const sid = d.session_id;
  // Seconde ceinture contre la recursion : Claude Code marque les Stop imbriques.
  // (La premiere est la variable AVS_SUJET_HOOK posee sur le fils.)
  if (d.stop_hook_active) return false;
  const etat = lireEtat(sid);
  // Le filet repasse regulierement, meme apres un signal fort : une session de 4 h
  // change de sujet en route, et une barre qui affiche le sujet du matin ment.
  const age = Date.now() - (etat.ts || 0);
  if (etat.texte && age < REVISION_MS) return false;
  if (!etat.texte && age < 60_000) return false; // rien a dire, on n'insiste pas chaque tour
  if (!apiKey()) return false;

  const messages = derniersMessagesUtilisateur(d.transcript_path);
  if (messages.length === 0) return false;
  const sujets = await listeSujets();
  if (sujets.length === 0) return false;

  const catalogue = sujets.map((s) => `${s.number}|${s.title}`).join("\n");
  const prompt = [
    "Voici la liste des sujets ouverts d'une entreprise, au format numero|titre :",
    catalogue,
    "",
    "Voici les derniers messages d'un utilisateur a son assistant de developpement :",
    messages.map((m) => "- " + m).join("\n"),
    "",
    "Sur quel sujet de la liste porte le travail EN COURS ? Les derniers messages priment :",
    "si la conversation a change de sujet en route, reponds sur le sujet actuel, pas celui du debut.",
    "Dans le doute, reponds none : un sujet faux est pire que pas de sujet.",
    "Reponds UNIQUEMENT le numero, rien d'autre (ex: 172), ou none.",
  ].join("\n");

  const rep = await claudeP(prompt);
  // La reponse doit etre UNIQUEMENT un numero. Avant, un `\b(\d+)\b` pechait le premier
  // nombre venu dans une phrase ("aucun des 181 sujets ne correspond" donnait 181) et
  // collait a une session un sujet qui n'avait rien a voir avec son travail.
  const m = rep && rep.trim().match(/^#?(\d{1,4})\.?$/);
  if (!m) {
    // "none" : plus rien de la liste ne correspond. Si le sujet affiche est vieux, on
    // l'EFFACE au lieu de le laisser mentir — pas de 🎯 vaut mieux qu'un faux 🎯.
    // Un sujet pose il y a moins de VERROU_MS est conserve : l'humain vient de le dire.
    if (etat.texte && Date.now() - (etat.ts || 0) > VERROU_MS) {
      try {
        fs.unlinkSync(path.join(SUJETS_DIR, `session-${sid}.txt`));
      } catch {}
      ecrireEtat(sid, { ts: Date.now(), source: "filet" });
      return true;
    }
    // On note le passage : sans ca le filet repartirait a chaque tour.
    ecrireEtat(sid, { ...etat, ts: Date.now(), source: etat.source || "filet" });
    return false;
  }
  const t = await formaterParNumero(m[1]);
  if (!t) return false;
  // Remplacer un sujet deja affiche demande une CONFIRMATION : le filet doit proposer le
  // meme sujet deux fois de suite. Sans ca il oscillait d'un sujet a l'autre au fil des
  // tours (constate le 12/09 sur une session voisine : #181 puis #102, alors que le bon
  // etait #12). Quand rien n'est affiche, on pose des la premiere deduction.
  if (etat.texte && etat.texte !== t) {
    if (etat.candidat !== t) {
      ecrireEtat(sid, { ...etat, candidat: t, ts: Date.now() });
      return false;
    }
  }
  const pose = poser(sid, t, "filet");
  if (pose) ecrireEtat(sid, { ...lireEtat(sid), candidat: null });
  return pose;
}

// --- 4. Menage ---------------------------------------------------------------

function surFinSession(d) {
  const sid = d.session_id;
  for (const f of [path.join(SUJETS_DIR, `session-${sid}.txt`), etatFile(sid)]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  // Les sessions tuees brutalement ne passent jamais ici : on balaye au passage.
  try {
    for (const nom of fs.readdirSync(SUJETS_DIR)) {
      if (!nom.startsWith("session-") && !nom.startsWith(".etat-")) continue;
      const f = path.join(SUJETS_DIR, nom);
      if (Date.now() - fs.statSync(f).mtimeMs > PURGE_APRES_MS) fs.unlinkSync(f);
    }
  } catch {}
}

// --- Aiguillage --------------------------------------------------------------

const d = await lireStdin();
if (d && d.session_id) {
  const ev = d.hook_event_name || process.argv[2];
  try {
    if (ev === "UserPromptSubmit") await surPrompt(d);
    else if (ev === "PostToolUse") await surOutil(d);
    else if (ev === "Stop") await surStop(d);
    else if (ev === "SessionEnd") surFinSession(d);
  } catch {
    // Un hook qui echoue ne doit jamais gener la session : on sort en silence.
  }
}
process.exit(0);
