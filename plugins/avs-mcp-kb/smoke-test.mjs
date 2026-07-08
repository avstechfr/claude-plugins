// Smoke test : lance le serveur, verifie tools/list et chaque outil contre la vraie API.
// Le noeud cree par kb_log est supprime a la fin (pas de pollution de la KB).
// Prerequis : AVS_API_KEY dans l'environnement.

import { spawn } from "node:child_process";

if (!process.env.AVS_API_KEY) {
  console.error("AVS_API_KEY manquant");
  process.exit(1);
}

const child = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000);
    t.unref();
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
  });
}

function toolText(res) {
  return res.result?.content?.[0]?.text || "";
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok ? "" : " -> " + detail}`);
  if (!ok) failures++;
}

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name).sort();
  check("tools/list = 5 outils kb_*", JSON.stringify(names) === JSON.stringify(["kb_get", "kb_link", "kb_log", "kb_save", "kb_search"]), JSON.stringify(names));

  const search = await rpc("tools/call", { name: "kb_search", arguments: { query: "Logic Display affichage", maxNodes: 5 } });
  check("kb_search trouve Logic Display", toolText(search).includes("Logic Display"), toolText(search).slice(0, 150));

  const get = await rpc("tools/call", { name: "kb_get", arguments: { id: "cmktu2o96001d4b9c5ts94041" } });
  check("kb_get lit le noeud API Gmail", toolText(get).includes("API Gmail"), toolText(get).slice(0, 150));

  const refuse = await rpc("tools/call", {
    name: "kb_save",
    arguments: { title: "test secret", content: "password: hunter2", visibility: "public" },
  });
  check("kb_save refuse un secret en public", toolText(refuse).includes("REFUSE"), toolText(refuse).slice(0, 150));

  const log = await rpc("tools/call", {
    name: "kb_log",
    arguments: { title: "Smoke test avs-mcp-kb (a supprimer)", content: "Noeud de test du MCP KB, supprime automatiquement.", tags: ["test"] },
  });
  const logText = toolText(log);
  const nodeId = (logText.match(/noeud (\w+)/) || [])[1];
  check("kb_log cree et maille un noeud", Boolean(nodeId) && logText.includes("relie"), logText.slice(0, 200));

  // Nettoyage : suppression directe via l'API
  if (nodeId) {
    const res = await fetch(`${process.env.AVS_INTRANET_URL || "https://intra.avstech.fr"}/api/external/knowledge/nodes/${nodeId}`, {
      method: "DELETE",
      headers: { "X-API-Key": process.env.AVS_API_KEY },
    });
    check("nettoyage du noeud de test", res.ok, `HTTP ${res.status}`);
  }
} catch (err) {
  check("execution", false, err.message);
} finally {
  // Fermeture propre : fermer stdin du child (il sort naturellement), pas de process.exit
  // force cote parent — un exit pendant la fermeture des pipes declenche une assertion
  // libuv sous Windows. On laisse node sortir seul avec exitCode.
  child.stdin.end();
  await new Promise((r) => {
    child.once("close", r);
    setTimeout(() => { child.kill(); setTimeout(r, 500); }, 3000);
  });
}

process.exitCode = failures ? 1 : 0;
