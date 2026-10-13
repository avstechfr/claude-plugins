// Tests des regles de reveil : node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import {
  mentionne,
  estAccuse,
  contientDemande,
  estSimpleReponse,
  decider,
  ligneReveil,
} from "../hooks/mentions.mjs";

test("mentionne : nom exact, @tous, @all", () => {
  assert.ok(mentionne("@balances-helmac tu peux regarder ?", "balances-helmac"));
  assert.ok(mentionne("Salut @Balances-Helmac", "balances-helmac"));
  assert.ok(mentionne("@tous : livraison a 14 h", "x"));
  assert.ok(mentionne("info pour @all", "x"));
  assert.ok(!mentionne("rien pour toi", "balances-helmac"));
  assert.ok(!mentionne("mail a balances-helmac@avs.fr", "avs"));
});

test("mentionne : un suffixe ne declenche pas le voisin", () => {
  assert.ok(!mentionne("@balances-helmac-2 regarde", "balances-helmac"));
  assert.ok(!mentionne("@balances-helmac regarde", "balances-helmac-2"));
  assert.ok(!mentionne("@toussaint", "x"));
});

test("accuses de reception", () => {
  for (const t of ["Recu", "@a noté, merci !", "ok", "Bien reçu 👍", "merci beaucoup", "C'est noté.", "@a d'accord, parfait", "👍"]) {
    assert.ok(estAccuse(t), t);
  }
  for (const t of ["ok ?", "recu, peux-tu relancer la compile", "Merci de regarder le ticket 42", "noté. Le build .76 a echoue sur COL_Ticket"]) {
    assert.ok(!estAccuse(t), t);
  }
});

test("contientDemande", () => {
  assert.ok(contientDemande("tu as fini ?"));
  assert.ok(contientDemande("peux-tu relancer"));
  assert.ok(contientDemande("merci de verifier"));
  assert.ok(!contientDemande("voici le resultat : 3 fichiers"));
});

test("simple reponse a un message de l'agent", () => {
  const h = [
    { sender: "b", room: "default", message: "@a la compile est-elle ok ?" },
    { sender: "a", room: "default", message: "@b oui, 0 erreur" },
  ];
  // b reagit sans nouvelle question a ce que a vient de dire : pas de reveil de a
  assert.ok(estSimpleReponse({ sender: "b", room: "default", message: "@a top, je deploie" }, h, "a"));
  // b pose une nouvelle question : reveil
  assert.ok(!estSimpleReponse({ sender: "b", room: "default", message: "@a et les tests ?" }, h, "a"));
  // b relance alors que a n'a pas parle depuis son dernier message : ce n'est pas une reponse
  assert.ok(!estSimpleReponse({ sender: "b", room: "default", message: "@a des nouvelles" }, h.slice(0, 1), "a"));
  // autre salon : ne compte pas
  assert.ok(!estSimpleReponse({ sender: "b", room: "autre", message: "@a voila" }, h, "a"));
});

test("decider : siens, presence, plafond", () => {
  const ctx = () => ({ nom: "a", journal: {}, maintenant: 1e12, maxParHeure: 2 });
  assert.equal(decider({ sender: "a", message: "@a" }, ctx()).raison, "le-mien");
  assert.equal(decider({ sender: "b", room: "__presence", message: "@a" }, ctx()).raison, "presence");
  assert.equal(decider({ sender: "b", message: "salut" }, ctx()).raison, "pas-mentionne");
  assert.equal(decider({ sender: "b", message: "@a merci" }, ctx()).raison, "accuse");

  const c = ctx();
  const m = { sender: "b", room: "default", message: "@a peux-tu regarder ?" };
  for (let i = 0; i < 2; i++) {
    const d = decider(m, c);
    assert.equal(d.reveil, true);
    (c.journal.b ||= []).push(c.maintenant);
  }
  assert.equal(decider(m, c).raison, "plafond");
  // un autre expediteur n'est pas concerne par le plafond de b
  assert.equal(decider({ ...m, sender: "c" }, c).reveil, true);
  // une heure plus tard, le plafond est leve
  assert.equal(decider(m, { ...c, maintenant: c.maintenant + 3600001 }).reveil, true);
});

test("ligne de reveil : une seule ligne, autoportante", () => {
  const l = ligneReveil({ sender: "b", room: "default", message: "ligne 1\nligne 2 " + "x".repeat(400) }, "a");
  assert.ok(!l.includes("\n"));
  assert.ok(l.includes("b t'interpelle") && l.includes("chat_recv"));
  assert.ok(l.length < 400);
});
