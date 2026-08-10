// scrape-books.mjs
// Relève les cotes badminton des bookmakers français (Betclic, Unibet, Winamax)
// et les historise dans data/books/runs/.
//
//   node scrape-books.mjs
//
// APPEND-ONLY, comme data/odds/runs/ : un fichier par passage, nommé par
// l'instant du relevé, jamais réécrit. C'est l'évolution des cotes qui porte
// l'information (cote de clôture, sens du mouvement) — écraser un relevé
// détruirait précisément ce qu'on collecte. Ces relevés par OPÉRATEUR NOMMÉ
// sont la matière première des stats futures : EV réel par opérateur, CLV,
// comparaison inter-bookmakers d'un même match (jointure par srId Sportradar).
//
// Depuis 2026-08-10, chaque ligne prématch porte AUSSI, quand l'opérateur le
// cote, le marché « nombre de sets » (champ optionnel `sets`, documenté dans
// lib/books.mjs) — préalable du futur marché lié à l'effet gymnase (journal
// §7). Ajout strictement additif : les relevés antérieurs restent lisibles
// tels quels, et un marché absent ne fait jamais échouer le relevé vainqueur.

import fs from "node:fs/promises";
import path from "node:path";
import { runFileName } from "./lib/odds-history.mjs";
import { fetchBetclic, enrichBetclicSets } from "./lib/book-betclic.mjs";
import { fetchUnibet, enrichUnibetSets } from "./lib/book-unibet.mjs";
import { fetchWinamax, enrichWinamaxSets } from "./lib/book-winamax.mjs";

const OUT_DIR = path.join("data", "books", "runs");
const BOOKS = [
  ["betclic", fetchBetclic, enrichBetclicSets],
  ["unibet", fetchUnibet, enrichUnibetSets],
  ["winamax", fetchWinamax, enrichWinamaxSets],
];

await fs.mkdir(OUT_DIR, { recursive: true });

const fetchedAt = new Date().toISOString();
const books = {};
const errors = {};
for (const [i, [name, fn, enrichSets]] of BOOKS.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // on reste courtois
  try {
    const { rows: toutes, complete, ctx } = await fn();
    // PRÉMATCH SEULEMENT : les cotes live bougent point par point, et à un
    // relevé toutes les 2 h on n'en capturerait que des instantanés trompeurs
    // qui pollueraient les séries et la cote de clôture.
    const rows = toutes.filter((r) => !r.isLive);
    // Marché « nombre de sets » (lot C, effet gymnase §7 du journal) : BEST-
    // EFFORT après la capture du vainqueur — champ optionnel `sets` sur la
    // ligne (voir lib/books.mjs). Un échec ici ne coûte JAMAIS le relevé
    // vainqueur : les lignes sont déjà acquises, on ne fait que les enrichir.
    let setsNote = "";
    if (rows.length) {
      try {
        const n = await enrichSets(rows, ctx);
        setsNote = `, sets: ${n}/${rows.length}`;
      } catch (err) {
        setsNote = `, sets KO (${String(err.message || err)})`;
      }
    }
    books[name] = { complete, rows };
    const live = toutes.length - rows.length;
    console.log(`📗 ${name} — ${rows.length} lignes prématch${live ? ` (${live} live écartées)` : ""}${setsNote}${complete ? "" : " (INCOMPLET : des matchs du site manquent)"}`);
  } catch (err) {
    errors[name] = String(err.message || err);
    console.log(`⚠ ${name} : ${errors[name]}`);
  }
}

const total = Object.values(books).reduce((s, b) => s + b.rows.length, 0);
// Une seule écriture, en fin de passage : le fichier est immuable. Le relevé est
// écrit MÊME à zéro ligne : un passage sans matière (période creuse, opérateur
// qui bloque) doit rester visible dans la page /sante avec ses erreurs exactes —
// sans trace, « pourquoi la liste s'arrête-t-elle ? » est indiagnosticable.
// Les lectures (lib/books-history.mjs) ignorent naturellement un relevé sans
// lignes : il n'ajoute aucun point aux séries de cotes.
const file = path.join(OUT_DIR, runFileName(fetchedAt));
await fs.writeFile(file, JSON.stringify({ fetchedAt, errors, books }, null, 1));
if (total > 0) {
  console.log(`\n✅ ${total} lignes (${Object.keys(books).length}/${BOOKS.length} opérateurs) -> ${file}`);
} else {
  console.log(`\n⚠ aucune ligne récupérée : relevé vide écrit (erreurs consignées) -> ${file}`);
}

if (Object.keys(books).length === 0) {
  console.error("❌ Les trois opérateurs ont échoué : format changé ou blocage. À vérifier.");
  process.exitCode = 1;
}
