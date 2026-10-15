// Detection du sujet dans ce que tape l'humain : node --test "test/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { nettoyerPrompt, numeroDansTexte, parTitre, teteDeTitre } from "../hooks/lib-sujets.mjs";

const SUJETS = [
  { number: 181, title: "Outillage agents Claude Code" },
  { number: 225, title: "Nouveau logo Logic'S : validation" },
  { number: 172, title: "Balances Helmac Linux (GMB Reims) - remontee ventes + sync catalogue Cloud/Balance + telemaintenance" },
  { number: 133, title: "Rhomeo Decoration" },
];

test("mots generiques : la phrase de Nicolas du 15/10 ne pose aucun sujet", () => {
  for (const t of [
    "je devrais le voir dans ma barre en bas, dans mon Claude Code",
    "la barre dans la fenetre Claude Code ne se met pas a jour",
    "l'agent du chat, je ne sais pas quelle fenetre c'est",
    "un nouveau logo pour la caisse ?",
  ]) {
    assert.equal(parTitre(t, SUJETS), null, t);
    assert.equal(numeroDansTexte(t), null, t);
  }
});

test("titre quasi complet : pose le sujet", () => {
  assert.equal(parTitre("on reprend les balances Helmac Linux", SUJETS), "#172 Balances Helmac Linux (GMB Reims)");
  assert.equal(parTitre("point sur Rhomeo Decoration", SUJETS), "#133 Rhomeo Decoration");
  // Un seul mot du titre ne suffit pas.
  assert.equal(parTitre("la balance Helmac de GMB", SUJETS), null);
  assert.equal(teteDeTitre(SUJETS[2].title), "Balances Helmac Linux");
});

test("numero : #NNN explicite seulement", () => {
  assert.equal(numeroDansTexte("on passe sur le #181"), "181");
  assert.equal(numeroDansTexte("#225 au fait"), "225");
  assert.equal(numeroDansTexte("sujet 181"), null);
  assert.equal(numeroDansTexte("il y a 133 articles, version 3.6.0.78"), null);
  assert.equal(numeroDansTexte("caf&#225;"), null);
});

test("notification du chat arrivee comme prompt : ignoree", () => {
  const notif =
    "<task-notification>\n<task-id>btn07yj38</task-id>\n<summary>Monitor event: \"Chat inter-agents\"</summary>\n" +
    "<event>[agent-chat] outillage-agents t'interpelle (tu es logics) : « @tous #225, kit dans avs/marketing/logo-logics »</event>\n" +
    "</task-notification>";
  assert.equal(nettoyerPrompt(notif), "");
  assert.equal(numeroDansTexte(nettoyerPrompt(notif)), null);
  // Ligne du chat collee ou citee dans un vrai message : seule la partie de l'humain compte.
  const mixte = "> Tom : le nouveau logo #225 est pret\nregarde la generation .78";
  assert.equal(nettoyerPrompt(mixte), "regarde la generation .78");
  assert.equal(nettoyerPrompt("[agent-chat] x t'interpelle : #225\nok #181"), "ok #181");
});
