// Nom de chat stable (v2.6.0) : essais sur le vrai serveur MCP, store LOCAL dans un
// dossier temporaire (HOME redirige, cle API retiree : rien ne part sur l'intranet).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-identite-"));
const SUJETS = path.join(TMP, ".claude", "sujets");
const CHAT = path.join(TMP, ".avs", "agent-chat");

function env(extra) {
  const e = { ...process.env };
  for (const k of ["AVS_API_KEY", "AGENT_CHAT_HTTP_KEY", "AGENT_CHAT_HTTP_URL", "CLAUDE_PID", "AGENT_NAME", "CLAUDE_CODE_SESSION_ID"]) delete e[k];
  return {
    ...e,
    HOME: TMP,
    USERPROFILE: TMP,
    AGENT_CHAT_BACKEND: "file",
    AGENT_CHAT_FILE: path.join(TMP, "messages.jsonl"),
    ...extra,
  };
}

/** Pose le sujet d'une session comme le ferait le hook avs-statusline. */
function poserSujet(sid, texte, source) {
  fs.mkdirSync(SUJETS, { recursive: true });
  fs.writeFileSync(path.join(SUJETS, `session-${sid}.txt`), texte + "\n");
  fs.writeFileSync(path.join(SUJETS, `.etat-${sid}.json`), JSON.stringify({ texte, source, ts: Date.now() }));
}

function serveur(sid) {
  // cwd = dossier temporaire hors git : la base de repli est « agent-chat-identite-... ».
  const p = spawn(process.execPath, [path.join(RACINE, "server.mjs")], {
    env: env({ CLAUDE_CODE_SESSION_ID: sid }),
    cwd: TMP,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let id = 0;
  let tampon = "";
  const attentes = new Map();
  p.stdout.on("data", (c) => {
    tampon += c;
    let i;
    while ((i = tampon.indexOf("\n")) >= 0) {
      const r = JSON.parse(tampon.slice(0, i));
      tampon = tampon.slice(i + 1);
      attentes.get(r.id)?.(r);
    }
  });
  const outil = (name, args = {}) =>
    new Promise((ok) => {
      const n = ++id;
      attentes.set(n, (r) => {
        const t = r.result.content[0].text;
        ok(r.result.isError ? { erreur: t } : JSON.parse(t));
      });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
  const fin = () => new Promise((r) => (p.on("close", r), p.kill()));
  return { outil, fin };
}

const messages = () =>
  fs.readFileSync(path.join(TMP, "messages.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const registre = () => JSON.parse(fs.readFileSync(path.join(CHAT, "agents.json"), "utf8"));

test("un sujet pose par le filet ne nomme pas l'agent ; un sujet humain, si", async () => {
  poserSujet("s-filet", "#225 Nouveau logo Logic'S : validation", "filet");
  const a = serveur("s-filet");
  const qui = await a.outil("chat_whoami");
  assert.notEqual(qui.sender, "nouveau-logo");
  assert.match(qui.conseil, /chat_rename/);
  await a.fin();

  poserSujet("s-humain", "#172 Balances Helmac Linux (GMB Reims)", "humain");
  const b = serveur("s-humain");
  assert.equal((await b.outil("chat_whoami")).sender, "balances-helmac");
  await b.fin();
});

test("le nom fige au premier envoi ne bouge plus (redemarrage, registre perdu, sujet change)", async () => {
  poserSujet("s-stable", "#300 Generation exe trois", "humain");
  let a = serveur("s-stable");
  const envoi = await a.outil("chat_send", { message: "bonjour" });
  assert.equal(envoi.sender, "generation-exe");
  await a.fin();

  // Le registre est perdu (peremption, menage) et le sujet a change entre-temps.
  fs.writeFileSync(path.join(CHAT, "agents.json"), "{}");
  poserSujet("s-stable", "#225 Nouveau logo Logic'S : validation", "humain");
  a = serveur("s-stable");
  const qui = await a.outil("chat_whoami");
  assert.equal(qui.sender, "generation-exe");
  assert.equal(qui.fige, true);
  assert.equal((await a.outil("chat_send", { message: "encore moi" })).sender, "generation-exe");
  await a.fin();
});

test("chat_send : en-tete « de <nom> » automatique, signatures manuelles retirees", async () => {
  poserSujet("s-entete", "#301 Formules Pad", "humain");
  const a = serveur("s-entete");
  await a.outil("chat_send", { message: "@tous - de `autre-nom`. Livraison faite.\n\n— de autre-nom" });
  const m = messages().filter((x) => x.room === "default").at(-1);
  assert.equal(m.sender, "formules-pad");
  assert.equal(m.message, "de formules-pad\n@tous Livraison faite.");
  await a.fin();
});

test("chat_rename : fige, annonce, registre a jour, refuse un nom pris", async () => {
  poserSujet("s-renomme", "#302 Global Logic'S", "humain");
  const a = serveur("s-renomme");
  await a.outil("chat_send", { message: "premier message" });
  const avant = (await a.outil("chat_whoami")).sender;

  const r = await a.outil("chat_rename", { nom: "Generation 378" });
  assert.equal(r.sender, "generation-378");
  assert.equal(r.ancien, avant);

  // Annonce sur le chat, presence mise a jour.
  const tous = messages();
  const annonce = tous.filter((x) => x.room === "default").at(-1);
  assert.equal(annonce.sender, "generation-378");
  assert.match(annonce.message, new RegExp(`${avant} s'appelle desormais generation-378`));
  assert.match(tous.filter((x) => x.room === "__presence").at(-1).message, /anciennement/);

  // Registre (lu par la statusline) et fichier de session.
  const reg = registre();
  assert.equal(reg["generation-378"].session, "s-renomme");
  assert.equal(reg[avant], undefined);
  const sess = JSON.parse(fs.readFileSync(path.join(CHAT, "sessions", "s-renomme.json"), "utf8"));
  assert.equal(sess.nom, "generation-378");
  assert.equal(sess.choisi, true);

  // Les messages suivants partent sous le nouveau nom.
  assert.equal((await a.outil("chat_send", { message: "suite" })).sender, "generation-378");

  // Nom deja pris par une autre session : refus avec une proposition.
  const b = serveur("s-autre");
  const refus = await b.outil("chat_rename", { nom: "generation-378" });
  assert.match(refus.erreur, /deja pris.*generation-378-2/);
  await b.fin();
  await a.fin();
});

test("chat_agents : machine et sujet pour chaque nom", async () => {
  const a = serveur("s-agents");
  const liste = await a.outil("chat_agents");
  const g = liste.agents.find((x) => x.nom === "generation-378");
  assert.ok(g, JSON.stringify(liste));
  assert.equal(g.machine, os.hostname());
  assert.equal(g.sujet, "#302 Global Logic'S");
  await a.fin();
});

test("nomDeSession (hooks) suit le fichier de session sans ecrire le registre", async () => {
  const avant = fs.readFileSync(path.join(CHAT, "agents.json"), "utf8");
  const sortie = await new Promise((ok) => {
    const p = spawn(
      process.execPath,
      ["--input-type=module", "-e", `import { nomDeSession } from ${JSON.stringify(new URL("../identite.mjs", import.meta.url).href)}; console.log(JSON.stringify(nomDeSession("s-renomme")));`],
      { env: env({}), stdio: ["ignore", "pipe", "inherit"] },
    );
    let s = "";
    p.stdout.on("data", (c) => (s += c));
    p.on("close", () => ok(s));
  });
  assert.equal(JSON.parse(sortie).nom, "generation-378");
  assert.equal(fs.readFileSync(path.join(CHAT, "agents.json"), "utf8"), avant);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
