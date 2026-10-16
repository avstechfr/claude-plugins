// Segment 🤖 de la statusline : le nom de chat de la session, jamais `.claude/agent-name`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "statusline.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-test-"));
const CHAT = path.join(TMP, ".avs", "agent-chat");

function rendu(sid) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ session_id: sid, cwd: TMP, model: { display_name: "Opus" } }),
    env: { ...process.env, HOME: TMP, USERPROFILE: TMP },
    encoding: "utf8",
  });
  return r.stdout.trim();
}

test("sans plugin de chat sur le poste : pas de segment 🤖", () => {
  assert.doesNotMatch(rendu("s1"), /🤖/);
});

test("chat present, rien d'enregistre : 🤖 ?", () => {
  fs.mkdirSync(path.join(CHAT, "sessions"), { recursive: true });
  // Le repli `.claude/agent-name` ne doit plus apparaitre.
  fs.mkdirSync(path.join(TMP, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(TMP, ".claude", "agent-name"), "central");
  assert.match(rendu("s1"), /🤖 \? ·/);
});

test("nom provisoire au registre : « nom? » ; nom fige de la session : « nom »", () => {
  fs.writeFileSync(
    path.join(CHAT, "agents.json"),
    JSON.stringify({ logics: { session: "s1", fige: false, ts: Date.now() } }),
  );
  assert.match(rendu("s1"), /🤖 logics\? ·/);
  fs.writeFileSync(
    path.join(CHAT, "sessions", "s1.json"),
    JSON.stringify({ nom: "generation-378", fige: true, choisi: true, session: "s1" }),
  );
  assert.match(rendu("s1"), /🤖 generation-378 ·/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
