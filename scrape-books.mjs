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

import fs from "node:fs/promises";
import path from "node:path";
import { runFileName } from "./lib/odds-history.mjs";
import { fetchBetclic } from "./lib/book-betclic.mjs";
import { fetchUnibet } from "./lib/book-unibet.mjs";
import { fetchWinamax } from "./lib/book-winamax.mjs";

const OUT_DIR = path.join("data", "books", "runs");
const BOOKS = [
  ["betclic", fetchBetclic],
  ["unibet", fetchUnibet],
  ["winamax", fetchWinamax],
];

await fs.mkdir(OUT_DIR, { recursive: true });

const fetchedAt = new Date().toISOString();
const books = {};
const errors = {};
for (const [i, [name, fn]] of BOOKS.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // on reste courtois
  try {
    const { rows, complete } = await fn();
    books[name] = { complete, rows };
    console.log(`📗 ${name} — ${rows.length} lignes${complete ? "" : " (INCOMPLET : pagination tronquée)"}`);
  } catch (err) {
    errors[name] = String(err.message || err);
    console.log(`⚠ ${name} : ${errors[name]}`);
  }
}

const total = Object.values(books).reduce((s, b) => s + b.rows.length, 0);
if (total > 0) {
  // Une seule écriture, en fin de passage : le fichier est immuable.
  const file = path.join(OUT_DIR, runFileName(fetchedAt));
  await fs.writeFile(file, JSON.stringify({ fetchedAt, errors, books }, null, 1));
  console.log(`\n✅ ${total} lignes (${Object.keys(books).length}/${BOOKS.length} opérateurs) -> ${file}`);
} else {
  console.log("\n⚠ aucune ligne récupérée : aucun fichier écrit (on ne crée pas de relevé vide).");
}

if (Object.keys(books).length === 0) {
  console.error("❌ Les trois opérateurs ont échoué : format changé ou blocage. À vérifier.");
  process.exitCode = 1;
}
