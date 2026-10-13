// Essai reel du surveillant, sur le store LOCAL (FileStore) dans un dossier temporaire :
// deux identites (alice, bob) passent par le vrai serveur MCP (chat_send), le vrai
// surveillant tourne pour bob, et on verifie qu'il emet une ligne sur mention et rien
// sinon. Rien ne part sur le chat intranet : backend force a `file`, cle API retiree,
// HOME redirige.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-test-"));

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

/** Un agent = un serveur MCP agent-chat, pilote en JSON-RPC sur stdio. */
function agent(nom) {
  const p = spawn(process.execPath, [path.join(RACINE, "server.mjs")], {
    env: env({ AGENT_NAME: nom, CLAUDE_CODE_SESSION_ID: `sess-${nom}` }),
    stdio: ["pipe", "pipe", "inherit"],
  });
  let id = 0;
  let tampon = "";
  const attentes = new Map();
  p.stdout.on("data", (c) => {
    tampon += c;
    let i;
    while ((i = tampon.indexOf("\n")) >= 0) {
      const l = tampon.slice(0, i);
      tampon = tampon.slice(i + 1);
      const r = JSON.parse(l);
      attentes.get(r.id)?.(r);
    }
  });
  const appel = (method, params) =>
    new Promise((ok) => {
      const n = ++id;
      attentes.set(n, ok);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  return {
    envoie: (message) => appel("tools/call", { name: "chat_send", arguments: { message } }),
    fin: () => p.kill(),
  };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("le surveillant de bob emet une ligne sur mention, rien sinon", async () => {
  const alice = agent("alice");
  const bob = agent("bob");
  // Un message avant le demarrage du surveillant, sans mention : pris acte, jamais emis.
  await alice.envoie("bonjour, je demarre");

  const veille = spawn(
    process.execPath,
    [path.join(RACINE, "hooks", "watch-mentions.mjs"), "--intervalle", "1", "--duree", "9"],
    { env: env({ AGENT_NAME: "bob", CLAUDE_CODE_SESSION_ID: "sess-bob" }), stdio: ["ignore", "pipe", "pipe"] },
  );
  let sortie = "";
  let diag = "";
  veille.stdout.on("data", (c) => (sortie += c));
  veille.stderr.on("data", (c) => (diag += c));
  const finVeille = new Promise((r) => veille.on("close", r));
  await pause(1500);

  await alice.envoie("salut tout le monde"); // pas de mention
  await alice.envoie("@bob peux-tu verifier le build .76 ?"); // -> REVEIL
  await alice.envoie("@bob merci"); // accuse
  await bob.envoie("@alice c'est fait, 0 erreur"); // le sien
  await alice.envoie("@bob super, je deploie"); // simple reponse a bob, sans question
  await alice.envoie("@bob-2 tu es la ?"); // un autre agent
  await bob.envoie("@bob note pour moi-meme"); // le sien, meme mentionne
  await pause(2500);
  await alice.envoie("@tous point a 15 h, qui est dispo ?"); // -> REVEIL

  await finVeille;
  alice.fin();
  bob.fin();

  const lignes = sortie.trim().split("\n").filter(Boolean);
  assert.equal(lignes.length, 2, `sortie :\n${sortie}\ndiag :\n${diag}`);
  assert.match(lignes[0], /alice t'interpelle .*tu es bob.*verifier le build/);
  assert.match(lignes[1], /alice t'interpelle .*point a 15 h/);
  for (const l of lignes) assert.match(l, /chat_recv/);

  // Etat partage avec le hook : `dernierId` avance, le Stop ne relancera pas une 2e fois.
  const vu = JSON.parse(fs.readFileSync(path.join(TMP, ".avs", "agent-chat", "vu-sess-bob.json"), "utf8"));
  const tous = fs.readFileSync(path.join(TMP, "messages.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(vu.dernierId, tous.filter((m) => m.room === "default").at(-1).id);
  assert.match(diag, /pas de reveil \(accuse\)/);
  assert.match(diag, /pas de reveil \(simple-reponse\)/);
});

test("une mention deja livree par le hook n'est pas re-emise", async () => {
  const dossier = path.join(TMP, ".avs", "agent-chat");
  const fichier = path.join(TMP, "messages.jsonl");
  // Le surveillant de carol prend acte de l'existant...
  const lancer = () =>
    new Promise((ok) => {
      const p = spawn(process.execPath, [path.join(RACINE, "hooks", "watch-mentions.mjs"), "--une-fois"], {
        env: env({ AGENT_NAME: "carol", CLAUDE_CODE_SESSION_ID: "sess-carol" }),
        stdio: ["ignore", "pipe", "ignore"],
      });
      let s = "";
      p.stdout.on("data", (c) => (s += c));
      p.on("close", () => ok(s));
    });
  assert.equal(await lancer(), "");
  const alice = agent("alice");
  await alice.envoie("@carol tu peux relire la PR ?");
  alice.fin();
  // ...puis le hook (Stop/UserPromptSubmit) livre ce message avant la releve suivante.
  const dernier = fs.readFileSync(fichier, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  fs.writeFileSync(path.join(dossier, "vu-sess-carol.json"), JSON.stringify({ dernierId: dernier.id }));
  assert.equal(await lancer(), "");
});

test("session reprise : rattrape les mentions arrivees surveillant arrete", async () => {
  const dossier = path.join(TMP, ".avs", "agent-chat");
  const fichier = path.join(TMP, "messages.jsonl");
  const lus = () => fs.readFileSync(fichier, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // dave avait deja une session (le hook a vu jusqu'au dernier message)...
  fs.writeFileSync(path.join(dossier, "vu-sess-dave.json"), JSON.stringify({ dernierId: lus().at(-1).id }));
  // ...on l'interpelle pendant que Claude Code est ferme...
  const alice = agent("alice");
  await alice.envoie("@dave le client attend ta reponse sur le ticket 12 ?");
  alice.fin();
  // ...a la reprise, la premiere releve le reveille.
  const sortie = await new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(RACINE, "hooks", "watch-mentions.mjs"), "--une-fois"], {
      env: env({ AGENT_NAME: "dave", CLAUDE_CODE_SESSION_ID: "sess-dave" }),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let s = "";
    p.stdout.on("data", (c) => (s += c));
    p.on("close", () => ok(s));
  });
  assert.match(sortie, /alice(-\d+)? t'interpelle .*tu es dave.*ticket 12/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
