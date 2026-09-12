#!/usr/bin/env node
// Statusline AVS — rendu :
//   🎯 <sujet> · 📁 <repo> · 📂 <dossier> · 🤖 <agent> · 🌿 <branche> · ✨ <modele>
//
// Remplace le trio statusline-dispatch.sh + statusline.ps1 + statusline.sh.
// Motif : le dispatcher choisissait sa cible avec $OSTYPE, or sur un poste Windows
// ou `bash` est celui de WSL (et pas Git Bash), il repondait "linux-gnu" et ne
// savait meme pas ouvrir un chemin C:\... La statusline disparaissait sans message.
// Node se comporte pareil partout et est deja requis par les MCP AVS.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const git = (cwd, args) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

let d = {};
try {
  const morceaux = [];
  for await (const c of process.stdin) morceaux.push(c);
  d = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
} catch {}

// Ancre = projet de la session, pas le cwd : un `cd` ailleurs (commit dans un autre
// repo) ne doit pas faire sauter l'affichage sur un autre projet.
const ancre = d.workspace?.project_dir || d.cwd || process.cwd();
const cwd = d.workspace?.current_dir || d.cwd || process.cwd();

const racine = git(ancre, ["rev-parse", "--show-toplevel"]);
const projet = racine ? path.basename(racine) : d.workspace?.repo?.name || "—";
const branche = git(ancre, ["rev-parse", "--abbrev-ref", "HEAD"]) || "—";

// Agent : le nom sous lequel les AUTRES agents te voient sur le chat (registre tenu par
// avs-mcp-agent-chat, derive du sujet et rendu unique). On ne montre plus
// `.claude/agent-name` : ce fichier, versionne par repo, donnait le meme nom a toutes les
// fenetres, et faisait coexister deux notions de "nom d'agent". Il sert de repli tant
// qu'aucun nom de chat n'est enregistre pour la session.
let agent = "—";
if (d.session_id) {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".avs", "agent-chat", "agents.json"), "utf8")
    );
    const trouve = Object.entries(reg).find(([, e]) => e && e.session === d.session_id);
    if (trouve) agent = trouve[0];
  } catch {}
}
if (agent === "—" && racine) {
  try {
    agent = fs.readFileSync(path.join(racine, ".claude", "agent-name"), "utf8").trim() || "—";
  } catch {}
}

// Dossier courant relatif a la racine du repo ("." a la racine).
let dossier = ".";
try {
  if (racine) {
    const rel = path.relative(fs.realpathSync(racine), fs.realpathSync(cwd));
    dossier = rel === "" ? "." : rel.split(path.sep).join("/");
    if (rel.startsWith("..")) dossier = path.basename(cwd);
  } else {
    dossier = path.basename(cwd);
  }
} catch {}

// Sujet : UNIQUEMENT le fichier de cette session, ecrit par les hooks du plugin.
// Le fallback par repo a ete retire le 12/09/2026 : partage par toutes les fenetres
// et jamais rafraichi, il affichait un sujet vieux de deux mois a tout le monde.
// Mieux vaut pas de 🎯 qu'un 🎯 faux.
let sujet = null;
if (d.session_id) {
  try {
    sujet = fs.readFileSync(
      path.join(os.homedir(), ".claude", "sujets", `session-${d.session_id}.txt`),
      "utf8"
    ).trim() || null;
  } catch {}
}

const modele = d.model?.display_name || "?";
const ligne = `📁 ${projet} · 📂 ${dossier} · 🤖 ${agent} · 🌿 ${branche} · ✨ ${modele}`;
process.stdout.write((sujet ? `🎯 ${sujet} · ` : "") + ligne + "\n");
