#!/usr/bin/env node
// Audit local : quelles sessions Claude Code de ce poste se sont terminées avec des actions
// jamais enregistrées dans la KB ? Couvre ce que le rappel ne voit pas (fenêtre fermée en
// plein tour, session antérieure au rappel, sous-agent). Lecture seule. C'est une estimation :
// une écriture faite par un script au nom neutre, sans description, n'est pas reconnue.
//
//   node kb-audit.mjs [nombre de jours, 30 par défaut]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyser } from "./kb-rappel.mjs";

const jours = Number(process.argv[2]) || 30;
const depuis = Date.now() - jours * 24 * 60 * 60 * 1000;
const racine = path.join(os.homedir(), ".claude", "projects");

let total = 0;
const aRevoir = [];
for (const projet of fs.existsSync(racine) ? fs.readdirSync(racine) : []) {
  const dossier = path.join(racine, projet);
  if (!fs.statSync(dossier).isDirectory()) continue;
  for (const nom of fs.readdirSync(dossier)) {
    if (!nom.endsWith(".jsonl")) continue;
    const fichier = path.join(dossier, nom);
    const date = fs.statSync(fichier).mtimeMs;
    if (date < depuis) continue;
    total += 1;
    const { enAttente } = analyser(fs.readFileSync(fichier, "utf8").split("\n"));
    if (enAttente.length > 0) aRevoir.push({ date, nom, enAttente });
  }
}

console.log(`${total} sessions sur ${jours} jours, ${aRevoir.length} avec des actions non suivies d'une écriture en KB.`);
for (const { date, nom, enAttente } of aRevoir.sort((a, b) => b.date - a.date)) {
  const jour = new Date(date).toISOString().slice(0, 10);
  console.log(`${jour}  ${nom.slice(0, 8)}  ${enAttente.length} action(s), dernière : ${enAttente.at(-1).libelle}`);
}
