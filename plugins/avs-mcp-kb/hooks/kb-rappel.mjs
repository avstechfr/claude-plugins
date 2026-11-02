#!/usr/bin/env node
// Rappel d'enregistrement en KB — hook Stop du plugin avs-mcp-kb.
//
// La règle « écris dans la KB après avoir agi » existe depuis longtemps, mais elle reposait
// sur la mémoire de l'agent. Mesuré le 02/11/2026 sur un poste : des sessions avec des actions
// chez des clients n'avaient laissé aucune fiche. Ce qui doit arriver à chaque fois est
// exécuté par le harnais, pas espéré du modèle.
//
// À chaque fin de tour : si des actions à consigner n'ont pas été suivies d'une écriture en
// KB, l'agent est relancé une fois pour ce lot. S'il juge qu'il n'y a rien à retenir, il le
// dit et il s'arrête : le rappel ne revient qu'après une nouvelle action.
//
// Cadence, réglée en rejouant 212 vraies sessions : un rappel à chaque tour tombait sur plus
// d'un tour sur deux et aurait noyé la KB. Le 1er rappel part tout de suite, les suivants au
// plus toutes les 30 min, sauf action de production, rappelée à la fin de son tour.
//
// EN CAS DE DOUTE, ON LAISSE PASSER : ce hook ne doit jamais casser une session.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DELAI_ENTRE_RAPPELS_MS = 30 * 60 * 1000;
// La mémoire ou le ticket mis à jour juste après la fiche KB font partie de la même écriture.
const MARGE_APRES_ECRITURE_MS = 10 * 60 * 1000;

const AGENTS_LECTURE_SEULE = new Set(["Explore", "Plan", "claude-code-guide", "statusline-setup"]);
const VERBE_ECRITURE =
  /-Method\s+["']?(post|put|patch|delete)|-X\s*["']?(post|put|patch|delete)|--data|--json\b|\s-d\s|-Body\b|requests\.(post|put|patch|delete)|method\s*[:=]\s*["'](post|put|patch|delete)/i;

// Le dépôt est public : aucune donnée client dans ces motifs.
// Rappelées à la fin de leur tour, sans attendre le délai entre deux rappels.
const ACTIONS_PRODUCTION = [
  /\bgit\b[^\n|;&]*\bpush\b/i,
  /\bgh\s+pr\s+(create|merge)\b/i,
  /\b(systemctl|pm2)\s+(restart|reload|stop|start)\b/i,
  /\bprisma\s+migrate\s+(deploy|resolve)\b/i,
  /\bdeploy[\w-]*\.sh\b/i,
  /\bpsql\b/i,
];
const AUTRES_ACTIONS_SHELL = [
  /\b(ssh|scp|sftp|rsync)\s/i,
  /\b(Invoke-Command|Enter-PSSession|New-PSSession|New-CimSession|psexec)\b/i,
  /-(To|From)Session\b/i,
  /\b100\.64\.\d{1,3}\.\d{1,3}\b/, // machine du parc, par son adresse Tailscale
  /hfsql[_ -]?agent/i,
  // Un script de travail lancé depuis un dossier AVS : son nom ne dit rien de ce qu'il fait.
  /AVS[\\/](workspace|repos|outils)[^\s"']*\.(ps1|py|bat|cmd|mjs)\b/i,
  /\bcd\s+[^\n;&]*AVS[\\/](workspace|repos|outils)[^\n]*\b(python3?|py|node|pwsh|powershell)\b/i,
];
// Toute écriture sur l'intranet, sauf ce qui n'est que de la coordination ou de la lecture.
const API_INTRANET = /\/api\/external\/(?!knowledge|locks|agent-chat|onboarding)[\w-]/i;
// Une mémoire locale ou un livrable écrit ici reste invisible des collègues sans fiche KB.
const FICHIERS_A_CONSIGNER = /[\\/]AVS[\\/](memory|workspace)[\\/]/i;
// Beaucoup de fiches partent par un script maison (python trace.py) : seule sa description le dit.
const DESCRIPTION_KB = /\b(kb|n[œo]e?ud|node)\b/i;
const DESCRIPTION_ECRITURE =
  /cr[ée]|[ée]cri|enregistr|ajout|compl[éèe]t|\bmet|trac|\blog|publi|consign|\bnot/i;
const DESCRIPTION_LECTURE = /cherch|\blire|\blis\b|relire|\bvoir\b|regarde|v[ée]rifi/i;

function estEcritureKb(bloc) {
  if (/kb_(save|log)$/.test(bloc.name || "")) return true;
  if (bloc.name !== "Bash" && bloc.name !== "PowerShell") return false;
  const cmd = String(bloc.input?.command || "");
  if (/knowledge\/nodes/.test(cmd) && VERBE_ECRITURE.test(cmd)) return true;
  const description = String(bloc.input?.description || "");
  return (
    DESCRIPTION_KB.test(description) &&
    DESCRIPTION_ECRITURE.test(description) &&
    !DESCRIPTION_LECTURE.test(description)
  );
}

/** L'action si elle est à consigner, sinon null. */
function classerAction(bloc) {
  const nom = bloc.name || "";
  const entree = bloc.input || {};
  if (nom === "Bash" || nom === "PowerShell") {
    const cmd = String(entree.command || "");
    const production = ACTIONS_PRODUCTION.some((motif) => motif.test(cmd));
    const aConsigner =
      production ||
      AUTRES_ACTIONS_SHELL.some((motif) => motif.test(cmd)) ||
      (API_INTRANET.test(cmd) && VERBE_ECRITURE.test(cmd));
    if (!aConsigner) return null;
    return { libelle: String(entree.description || cmd.split("\n")[0]).slice(0, 100), production };
  }
  if (nom === "Write" || nom === "Edit" || nom === "NotebookEdit") {
    const fichier = String(entree.file_path || entree.notebook_path || "");
    return FICHIERS_A_CONSIGNER.test(fichier) ? { libelle: `Fichier ${path.basename(fichier)}` } : null;
  }
  // Un sous-agent travaille hors de ce journal : on ne voit pas ce qu'il a fait.
  if (nom === "Agent" || nom === "Task") {
    if (AGENTS_LECTURE_SEULE.has(entree.subagent_type)) return null;
    return { libelle: `Sous-agent : ${String(entree.description || "").slice(0, 80)}` };
  }
  if (nom === "Workflow") return { libelle: "Workflow multi-agents" };
  return null;
}

function estMessageHumain(entree) {
  if (entree.type !== "user" || entree.isMeta || entree.isSidechain) return false;
  const contenu = entree.message?.content;
  const texte = Array.isArray(contenu) ? contenu.find((bloc) => bloc?.type === "text")?.text : contenu;
  return typeof texte === "string" && !texte.trimStart().startsWith("<");
}

/**
 * Actions à consigner qui n'ont pas été suivies d'une écriture en KB. Une écriture solde tout
 * ce qui la précède, et aussi ce qui la suit de près dans le même tour.
 */
export function analyser(lignes) {
  const actions = [];
  let rang = 0;
  let tour = 0;
  let tourEcriture = -1;
  let derniereEcritureMs = 0;
  for (const ligne of lignes) {
    if (!ligne.includes('"tool_use"') && !ligne.includes('"user"')) continue;
    let entree;
    try {
      entree = JSON.parse(ligne);
    } catch {
      continue;
    }
    if (estMessageHumain(entree)) tour += 1;
    if (entree.type !== "assistant" || entree.isSidechain) continue;
    const blocs = entree.message?.content;
    if (!Array.isArray(blocs)) continue;
    const ms = Date.parse(entree.timestamp) || 0;
    for (const bloc of blocs) {
      if (bloc?.type !== "tool_use") continue;
      rang += 1;
      if (estEcritureKb(bloc)) {
        tourEcriture = tour;
        derniereEcritureMs = ms;
        continue;
      }
      const action = classerAction(bloc);
      if (action) actions.push({ ...action, rang, tour, ms });
    }
  }
  const enAttente = actions.filter(
    (action) =>
      action.tour > tourEcriture ||
      (action.tour === tourEcriture && action.ms > derniereEcritureMs + MARGE_APRES_ECRITURE_MS),
  );
  return { enAttente, derniereEcritureMs };
}

/** Le rappel à envoyer maintenant et l'état à garder, ou null s'il n'y a rien à dire. */
export function decider(lignes, etat = {}, maintenant = Date.now()) {
  const { enAttente, derniereEcritureMs } = analyser(lignes);
  // Déjà rappelé pour ces actions : l'agent a jugé, on ne boucle pas.
  const nouvelles = enAttente.filter((action) => action.rang > (etat.rangRappel || 0));
  if (nouvelles.length === 0) return null;
  const dernierSignalMs = Math.max(etat.rappelMs || 0, derniereEcritureMs);
  const tropTot = maintenant - dernierSignalMs < DELAI_ENTRE_RAPPELS_MS;
  if (tropTot && !nouvelles.some((action) => action.production)) return null;
  return {
    raison: messageRappel(enAttente),
    etat: { rangRappel: enAttente.at(-1).rang, rappelMs: maintenant },
  };
}

function messageRappel(enAttente) {
  const derniers = enAttente.slice(-5).map((action) => `- ${action.libelle}`);
  const autres = enAttente.length - derniers.length;
  return [
    "Rappel KB : ces actions n'ont pas encore été enregistrées dans la base de connaissances AVS :",
    ...derniers,
    ...(autres > 0 ? [`- (et ${autres} autres avant)`] : []),
    "",
    "Avant de t'arrêter, enregistre ce qui servira à un collègue ou à un autre agent : constat, cause, solution, état réel, ce qui reste à faire.",
    "- kb_search d'abord : s'il existe une fiche du sujet, enrichis-la avec kb_save et son nodeId ; sinon crée-la avec kb_log.",
    "- Seulement ce qui a été vérifié, et jamais de secret.",
    "",
    "Si l'écriture a déjà été faite par un script, si ces actions n'apprennent rien, ou si la session est perso et hors AVS : n'écris rien dans la KB, dis-le en une ligne et arrête-toi. Ce rappel ne reviendra pas pour ces actions.",
  ].join("\n");
}

const PURGE_APRES_MS = 7 * 24 * 60 * 60 * 1000;

function purgerEtats(dossier) {
  for (const nom of fs.readdirSync(dossier)) {
    const fichier = path.join(dossier, nom);
    if (Date.now() - fs.statSync(fichier).mtimeMs > PURGE_APRES_MS) fs.rmSync(fichier, { force: true });
  }
}

function surFinDeTour(donnees) {
  if (!donnees.session_id || !donnees.transcript_path) return;
  const dossier = path.join(os.homedir(), ".avs", "kb-rappel");
  const etatFichier = path.join(dossier, `${path.basename(donnees.session_id)}.json`);
  let etat = {};
  try {
    etat = JSON.parse(fs.readFileSync(etatFichier, "utf8"));
  } catch {}
  const lignes = fs.readFileSync(donnees.transcript_path, "utf8").split("\n");
  const rappel = decider(lignes, etat);
  if (!rappel) return;
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(etatFichier, JSON.stringify(rappel.etat), "utf8");
  purgerEtats(dossier);
  // Accents échappés en \uXXXX : ce JSON passe intact quel que soit le décodage de la console.
  const sortie = JSON.stringify({ decision: "block", reason: rappel.raison });
  process.stdout.write(
    sortie.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`),
  );
}

const ceFichier = fileURLToPath(import.meta.url);
const lanceDirectement = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ceFichier);

if (lanceDirectement) {
  // Une copie locale (rappel posé à la main avant ce plugin) garde la main : pas de double relance.
  const copieLocale = path.join(os.homedir(), ".claude", "hooks", "kb-rappel.mjs");
  const estCopieLocale = path.resolve(ceFichier).toLowerCase() === copieLocale.toLowerCase();
  if (estCopieLocale || !fs.existsSync(copieLocale)) {
    try {
      const morceaux = [];
      for await (const morceau of process.stdin) morceaux.push(morceau);
      surFinDeTour(JSON.parse(Buffer.concat(morceaux).toString("utf8")));
    } catch {
      // Un rappel ne doit jamais casser une session.
    }
  }
}
