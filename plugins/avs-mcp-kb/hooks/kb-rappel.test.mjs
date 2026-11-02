// Tests du rappel KB : node --test plugins/avs-mcp-kb/hooks/kb-rappel.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyser, decider } from "./kb-rappel.mjs";

let compteur = 0;
const T0 = Date.parse("2026-11-02T10:00:00Z");
const MIN = 60 * 1000;
const outil = (name, input, ms = T0) =>
  JSON.stringify({
    type: "assistant",
    timestamp: new Date(ms).toISOString(),
    message: { content: [{ type: "tool_use", id: `t${++compteur}`, name, input }] },
  });
const shell = (command, ms) => outil("Bash", { command }, ms);
const kbLog = (ms) => outil("mcp__plugin_avs-mcp-kb_avs-kb__kb_log", { title: "t", content: "c" }, ms);
const humain = (texte = "et ensuite ?") => JSON.stringify({ type: "user", message: { content: texte } });

const nb = (...lignes) => analyser(lignes).enAttente.length;

test("une action sans écriture en KB reste en attente", () => {
  assert.equal(nb(shell("ssh avs@serveur hostname")), 1);
});

test("une écriture en KB solde les actions d'avant, pas celles du tour suivant", () => {
  assert.equal(nb(shell("ssh avs@serveur hostname"), kbLog()), 0);
  assert.equal(nb(kbLog(), humain(), shell("ssh avs@serveur hostname")), 1);
});

test("la mémoire mise à jour juste après la fiche KB n'est pas un oubli", () => {
  const memoire = outil("Edit", { file_path: "C:\\x\\AVS\\memory\\MEMORY-AVS.md" }, T0 + 2 * MIN);
  assert.equal(nb(kbLog(T0), memoire), 0);
});

test("un long tour : ce qui suit la fiche de loin redevient à consigner", () => {
  assert.equal(nb(kbLog(T0), shell("ssh avs@serveur hostname", T0 + 60 * MIN)), 1);
});

test("un POST sur knowledge/nodes compte comme écriture, un GET non", () => {
  const post = shell('curl -X POST -H "X-API-Key: k" https://intra/api/external/knowledge/nodes --data-binary @f.json');
  const get = shell('curl -H "X-API-Key: k" https://intra/api/external/knowledge/nodes?limit=5');
  assert.equal(nb(shell("git push origin main"), post), 0);
  assert.equal(nb(shell("git push origin main"), get), 1);
});

test("une fiche écrite par un script maison se reconnaît à sa description", () => {
  const script = (description) => outil("Bash", { command: "python trace.py", description });
  assert.equal(nb(humain(), shell("ssh a b"), script("Créer le nœud KB et le ticket intranet")), 0);
  assert.equal(nb(humain(), shell("ssh a b"), script("Publie le commentaire et la fiche KB")), 0);
  assert.equal(nb(humain(), shell("ssh a b"), script("Compléter le nœud KB avec la suite")), 0);
  assert.equal(nb(humain(), shell("ssh a b"), script("Chercher dans la KB la procédure")), 1);
  assert.equal(nb(humain(), shell("ssh a b"), script("Voir comment tracer dans la KB")), 1);
});

test("les commandes locales et les lectures ne déclenchent rien", () => {
  assert.equal(nb(shell("git status"), shell("ls -la"), shell("git log --oneline -5")), 0);
  assert.equal(nb(shell('curl -H "X-API-Key: k" https://intra/api/external/tickets?limit=5')), 0);
  assert.equal(nb(shell("curl -X POST https://intra/api/external/knowledge/context -d @q.json")), 0);
  assert.equal(nb(shell("curl -X POST https://intra/api/external/locks -d @q.json")), 0);
});

test("les écritures sur l'intranet et les accès au parc déclenchent", () => {
  assert.equal(nb(shell("curl -X POST https://intra/api/external/tickets -d @t.json")), 1);
  assert.equal(nb(shell("Test-NetConnection 100.64.0.12 -Port 22")), 1);
  assert.equal(nb(shell("Invoke-Command -ComputerName caisse { hostname }")), 1);
  assert.equal(nb(shell("git -c credential.helper= push origin ma-branche")), 1);
  assert.equal(nb(shell("python C:/Users/x/AVS/workspace/client/poser.py")), 1);
});

test("fichiers : mémoire et livrables oui, secrets et brouillons non", () => {
  assert.equal(nb(outil("Write", { file_path: "C:\\Users\\x\\AVS\\memory\\fiche.md" })), 1);
  assert.equal(nb(outil("Edit", { file_path: "/home/x/AVS/workspace/client/mail.html" })), 1);
  assert.equal(nb(outil("Write", { file_path: "C:\\Users\\x\\AVS\\secrets\\cle.json" })), 0);
  assert.equal(nb(outil("Write", { file_path: "C:\\Temp\\brouillon.md" })), 0);
});

test("sous-agents : ceux qui peuvent agir seulement", () => {
  assert.equal(nb(outil("Agent", { subagent_type: "Explore", description: "chercher" })), 0);
  assert.equal(nb(outil("Agent", { subagent_type: "general-purpose", description: "poser" })), 1);
});

test("lignes illisibles et messages de sous-agent ignorés", () => {
  const sidechain = JSON.stringify({
    type: "assistant",
    isSidechain: true,
    message: { content: [{ type: "tool_use", id: "s", name: "Bash", input: { command: "ssh a b" } }] },
  });
  assert.equal(nb('{"tool_use" pas du json', "", sidechain), 0);
});

test("les résultats d'outils et les rappels système ne comptent pas comme un tour", () => {
  const resultat = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
  });
  const rappelSysteme = humain("<system-reminder>x</system-reminder>");
  assert.equal(nb(kbLog(T0), resultat, rappelSysteme, shell("ssh a b", T0 + MIN)), 0);
});

test("cadence : 1er rappel tout de suite, puis au plus toutes les 30 min", () => {
  const lignes = [shell("ssh a b", T0)];
  const premier = decider(lignes, {}, T0 + MIN);
  assert.ok(premier, "1er rappel immédiat");
  lignes.push(humain(), shell("ssh a c", T0 + 5 * MIN));
  assert.equal(decider(lignes, premier.etat, T0 + 6 * MIN), null, "trop tôt pour une action ordinaire");
  assert.ok(decider(lignes, premier.etat, T0 + 40 * MIN), "le délai passé, l'action reste rappelée");
});

test("cadence : une action de production n'attend pas", () => {
  const lignes = [shell("ssh a b", T0)];
  const premier = decider(lignes, {}, T0 + MIN);
  lignes.push(humain(), shell("git push origin main", T0 + 2 * MIN));
  assert.ok(decider(lignes, premier.etat, T0 + 3 * MIN));
});

test("cadence : pas de 2e rappel pour le même lot, même longtemps après", () => {
  const lignes = [shell("ssh a b", T0)];
  const premier = decider(lignes, {}, T0 + MIN);
  assert.equal(decider(lignes, premier.etat, T0 + 600 * MIN), null);
});

test("cadence : une fiche écrite spontanément repousse le rappel suivant", () => {
  const lignes = [kbLog(T0), humain(), shell("ssh a b", T0 + 5 * MIN)];
  assert.equal(decider(lignes, {}, T0 + 6 * MIN), null);
  assert.ok(decider(lignes, {}, T0 + 31 * MIN));
});

test("chaque session : relancée une fois, même sans action", () => {
  const lignes = [humain("une question ?")];
  const rappel = decider(lignes, {}, T0);
  assert.match(rappel.raison, /chaque session AVS/);
  assert.match(rappel.raison, /perso/);
  assert.equal(decider(lignes, rappel.etat, T0 + 600 * MIN), null, "une seule fois");
});

test("chaque session : rien à dire si elle a déjà écrit en KB", () => {
  assert.equal(decider([humain(), kbLog(T0)], {}, T0 + MIN), null);
});

test("chaque session : ni pour un script (claude -p), ni avant un vrai message", () => {
  const automatique = JSON.stringify({ type: "user", entrypoint: "sdk-cli", message: { content: "classe ce sujet" } });
  assert.equal(decider([automatique], {}, T0), null);
  assert.equal(decider([humain("<command-name>/help</command-name>")], {}, T0), null);
});

test("chaque session : un script qui agit reste rappelé pour ses actions", () => {
  const automatique = JSON.stringify({ type: "user", entrypoint: "sdk-cli", message: { content: "pose" } });
  assert.ok(decider([automatique, shell("ssh a b", T0)], {}, T0 + MIN));
});

test("chaque session : AVS_KB_RAPPEL_SESSION=0 le coupe sur un poste, pas le rappel des actions", () => {
  process.env.AVS_KB_RAPPEL_SESSION = "0";
  try {
    assert.equal(decider([humain("une question ?")], {}, T0), null);
    assert.ok(decider([humain(), shell("ssh a b", T0)], {}, T0 + MIN));
  } finally {
    delete process.env.AVS_KB_RAPPEL_SESSION;
  }
});

// Le hook complet, tel que le harnais le lance.
const hook = fileURLToPath(new URL("./kb-rappel.mjs", import.meta.url));

function lancer(home, entree) {
  return spawnSync(process.execPath, [hook], {
    input: entree,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

test("hook complet : relance une fois par lot, puis laisse s'arrêter", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kb-rappel-"));
  const transcript = path.join(home, "session.jsonl");
  const entree = JSON.stringify({ session_id: "s1", transcript_path: transcript });

  fs.writeFileSync(transcript, `${shell("ssh avs@serveur hostname")}\n`);
  const premier = lancer(home, entree);
  assert.equal(premier.status, 0);
  const sortie = JSON.parse(premier.stdout);
  assert.equal(sortie.decision, "block");
  assert.match(sortie.reason, /kb_log/);
  assert.match(sortie.reason, /enregistré/, "accents rendus à l'identique");
  assert.match(premier.stdout, /^[\x00-\x7e]*$/, "sortie en ASCII pur");

  assert.equal(lancer(home, entree).stdout, "", "pas de 2e relance pour le même lot");

  fs.appendFileSync(transcript, `${humain()}\n${shell("git push origin ma-branche")}\n`);
  assert.equal(JSON.parse(lancer(home, entree).stdout).decision, "block", "action de production, nouveau rappel");

  fs.appendFileSync(transcript, `${kbLog()}\n`);
  assert.equal(lancer(home, entree).stdout, "", "écriture faite, plus rien à rappeler");
});

test("hook complet : ne casse jamais une session", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kb-rappel-"));
  for (const entree of ["", "pas du json", JSON.stringify({ session_id: "s", transcript_path: "/absent.jsonl" })]) {
    const resultat = lancer(home, entree);
    assert.equal(resultat.status, 0);
    assert.equal(resultat.stdout, "");
  }
});

test("hook complet : une copie locale du rappel garde la main sur celle du plugin", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kb-rappel-"));
  fs.mkdirSync(path.join(home, ".claude", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "hooks", "kb-rappel.mjs"), "");
  const transcript = path.join(home, "session.jsonl");
  fs.writeFileSync(transcript, `${shell("ssh avs@serveur hostname")}\n`);
  const entree = JSON.stringify({ session_id: "s2", transcript_path: transcript });
  assert.equal(lancer(home, entree).stdout, "");
});
