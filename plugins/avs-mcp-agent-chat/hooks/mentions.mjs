// Regles de reveil du surveillant de mentions (v2.5.0) : fonctions pures, testables
// sans reseau ni fichier (voir test/mentions.test.mjs).
//
// Le surveillant reveille un agent INACTIF. C'est puissant et dangereux : deux agents qui
// se repondent peuvent se relancer l'un l'autre sans fin, sans humain pour couper. D'ou
// trois garde-fous, appliques dans cet ordre :
//   1. accuse de reception (« recu », « merci », « ok ») : jamais de reveil ;
//   2. simple reponse a un message de l'agent lui-meme, sans nouvelle question : pas de
//      reveil (le message reste livre par les hooks au prochain tour, rien ne se perd) ;
//   3. plafond de reveils par heure et par expediteur.

/** Echappe un texte pour l'inserer dans une RegExp. */
function echapper(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vrai si `texte` interpelle `nom` (`@nom`) ou tout le monde (`@tous`, `@all`).
 *  Le nom doit etre complet : `@balances-helmac` ne doit PAS reveiller
 *  `balances-helmac-2` (et inversement) — `\b` ne suffit pas, le tiret est un separateur. */
export function mentionne(texte, nom) {
  const t = String(texte || "");
  const fin = "(?![a-z0-9_-])";
  if (new RegExp(`(^|[^a-z0-9_-])@(tous|all)${fin}`, "i").test(t)) return true;
  if (!nom) return false;
  return new RegExp(`(^|[^a-z0-9_-])@${echapper(nom)}${fin}`, "i").test(t);
}

function normaliser(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/@[a-z0-9_-]+/g, " ") // les mentions ne comptent pas comme contenu
    .replace(/[’`]/g, "'");
}

// Vocabulaire d'un accuse de reception. Un message n'est un accuse que si TOUS ses mots
// sont dans cette liste (et qu'il est court, sans question).
const MOTS_ACCUSE = new Set(
  (
    "ok okay oki okk d'accord dac daccord recu recue bien note notee noted merci thanks thx " +
    "parfait top super nickel impeccable entendu compris vu roger ca marche marche c'est " +
    "cest pris en compte bonne journee soiree a toi vous de rien beaucoup pour l'info info " +
    "je tu on te le la les et c ca yes oui cool genial excellent tres"
  ).split(/\s+/),
);

/** Vrai si le message n'est qu'un accuse de reception (« Recu, merci ! », « @x ok 👍 »). */
export function estAccuse(texte) {
  if (String(texte || "").includes("?")) return false;
  const n = normaliser(texte);
  const mots = n.split(/[^a-z0-9']+/).filter(Boolean).map((m) => m.replace(/^'+|'+$/g, ""));
  if (mots.length === 0) return true; // que des mentions / emojis / ponctuation
  if (mots.length > 8) return false;
  return mots.every((m) => !m || MOTS_ACCUSE.has(m));
}

// Ce qui fait d'un message une nouvelle demande, meme sans point d'interrogation.
const DEMANDE =
  /\?|\b(peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|tu peux|merci de|stp|svp|s'il te plait|urgent|a faire|demande|besoin)\b/;

/** Vrai si le texte porte une question ou une demande explicite. */
export function contientDemande(texte) {
  return DEMANDE.test(normaliser(texte).replace(/\s+/g, " "));
}

/** Vrai si `m` ne fait que repondre a l'agent : l'agent a parle dans ce salon apres le
 *  precedent message de l'expediteur (donc l'expediteur lui repond), et `m` ne contient
 *  aucune nouvelle question ni demande.
 *  `historique` : messages du salon ANTERIEURS a `m`, dans l'ordre. */
export function estSimpleReponse(m, historique, nom) {
  if (contientDemande(m.message)) return false;
  for (let i = historique.length - 1; i >= 0; i--) {
    const h = historique[i];
    if ((h.room || "default") !== (m.room || "default")) continue;
    if (h.sender === nom) return true; // l'agent a parle en dernier : m lui repond
    if (h.sender === m.sender) return false; // l'expediteur relance sans reponse entre-temps
  }
  return false;
}

/** Plafond de reveils : `journal` = { expediteur: [timestamps ms] }. Mute le journal. */
export function sousPlafond(journal, expediteur, maintenant, maxParHeure) {
  const heure = 60 * 60 * 1000;
  const recents = (journal[expediteur] || []).filter((t) => maintenant - t < heure);
  journal[expediteur] = recents;
  return recents.length < maxParHeure;
}

export function noterReveil(journal, expediteur, maintenant) {
  (journal[expediteur] ||= []).push(maintenant);
}

/** Decision complete pour UN message. Renvoie { reveil: bool, raison }. */
export function decider(m, { nom, historique = [], journal = {}, maintenant = Date.now(), maxParHeure = 6 }) {
  if (!m || !m.sender) return { reveil: false, raison: "sans-expediteur" };
  if (m.sender === nom) return { reveil: false, raison: "le-mien" };
  if ((m.room || "") === "__presence") return { reveil: false, raison: "presence" };
  if (!mentionne(m.message, nom)) return { reveil: false, raison: "pas-mentionne" };
  if (estAccuse(m.message)) return { reveil: false, raison: "accuse" };
  if (estSimpleReponse(m, historique, nom)) return { reveil: false, raison: "simple-reponse" };
  if (!sousPlafond(journal, m.sender, maintenant, maxParHeure)) return { reveil: false, raison: "plafond" };
  return { reveil: true, raison: "mention" };
}

/** La ligne emise (une seule, autoportante : c'est elle qui reveille l'agent). */
export function ligneReveil(m, nom, maxCars = 160) {
  const texte = String(m.message || "").replace(/\s+/g, " ").trim();
  const debut = texte.length > maxCars ? texte.slice(0, maxCars) + "…" : texte;
  return (
    `[agent-chat] ${m.sender} t'interpelle (tu es ${nom}, salon ${m.room || "default"}) : ` +
    `« ${debut} » -> appelle chat_recv pour lire le message entier, traite-le s'il te ` +
    `concerne et reponds avec chat_send (pas d'accuse de reception seul).`
  );
}
