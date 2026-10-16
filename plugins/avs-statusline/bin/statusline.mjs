#!/usr/bin/env node
// Statusline AVS — rendu :
//   🎯 <sujet> · 📁 <repo> · 📂 <dossier> · 🤖 <nom de chat> · 🌿 <branche> · ✨ <modele>
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

// Agent : le nom sous lequel les AUTRES agents te voient sur le chat, tenu par
// avs-mcp-agent-chat :
//   1. ~/.avs/agent-chat/sessions/<sid>.json : nom fige (premier message) ou choisi
//      (chat_rename) — il ne change plus de la session ;
//   2. ~/.avs/agent-chat/agents.json : nom provisoire (aucun message encore envoye),
//      affiche avec un « ? » final parce qu'il peut encore bouger ;
//   3. rien d'enregistre : « ? ». Plus de repli sur `.claude/agent-name` (v2.4.0) : ce
//      fichier versionne donne le meme nom a toutes les fenetres d'un repo, et Nicolas
//      cherchait sur le chat un agent qui n'existait pas.
// Segment absent si le plugin de chat n'a jamais tourne sur ce poste.
const CHAT = path.join(os.homedir(), ".avs", "agent-chat");
let agent = null;
if (fs.existsSync(CHAT)) {
  agent = "?";
  if (d.session_id) {
    const sid = String(d.session_id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    try {
      const s = JSON.parse(fs.readFileSync(path.join(CHAT, "sessions", `${sid}.json`), "utf8"));
      if (s && s.nom && s.fige) agent = s.nom;
    } catch {}
    if (agent === "?") {
      try {
        const reg = JSON.parse(fs.readFileSync(path.join(CHAT, "agents.json"), "utf8"));
        const miennes = Object.entries(reg)
          .filter(([, e]) => e && e.session === d.session_id)
          .sort(([, a], [, b]) => (b.fige ? 1 : 0) - (a.fige ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
        if (miennes.length) agent = miennes[0][1].fige ? miennes[0][0] : `${miennes[0][0]}?`;
      } catch {}
    }
  }
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
const ligne = `📁 ${projet} · 📂 ${dossier} · ${agent ? `🤖 ${agent} · ` : ""}🌿 ${branche} · ✨ ${modele}`;
process.stdout.write((sujet ? `🎯 ${sujet} · ` : "") + ligne + "\n");
