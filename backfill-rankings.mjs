// backfill-rankings.mjs
// ONE-SHOT : constitue l'historique hebdomadaire du classement mondial BWF sur
// toute la fenêtre exposée par l'API (60 semaines glissantes).
//
//   node backfill-rankings.mjs             # index puis téléchargement des manquants
//   node backfill-rankings.mjs --index     # rafraîchit seulement l'index
//   node backfill-rankings.mjs --force     # réécrit les fichiers déjà présents
//
// Relançable sans perte : une publication déjà téléchargée est sautée, donc une
// interruption réseau se reprend là où elle s'est arrêtée.
//
// ATTENTION : l'API n'expose que 60 semaines. Ce qui n'est pas archivé dans
// data/rankings/ avant d'en sortir est perdu pour toujours. D'où la fusion de
// l'index (jamais un remplacement) et l'obligation de committer le résultat.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BwfClient } from "./lib/client.mjs";
import { fetchPublicationIndex, mergeIndex, loadIndex, saveIndex } from "./lib/publications.mjs";
import { fetchPublication, DEFAULT_DEPTH } from "./lib/rankings.mjs";
import { savePublication } from "./lib/rank-history.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, "data", "rankings");
const INDEX_PATH = join(DIR, "publications.json");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const INDEX_ONLY = args.includes("--index");

const client = await new BwfClient().start();

try {
  // ---- 1) Index : API + fusion avec l'archive locale ----------------------
  console.log("Récupération de l'index des publications (1 requête)…");
  const distant = await fetchPublicationIndex(client);
  console.log(`   ${distant.publications.length} publications côté API : ` +
    `${distant.publications[0].date} → ${distant.publications.at(-1).date}`);

  const local = await loadIndex(INDEX_PATH);
  const fusion = mergeIndex(local?.publications ?? [], distant.publications);
  if (local) {
    const gardees = fusion.length - distant.publications.length;
    console.log(`   index local : ${local.publications.length} entrées` +
      (gardees > 0 ? `, dont ${gardees} archivée(s) hors fenêtre API` : ""));
  }

  const index = { source: distant.source, fetchedAt: distant.fetchedAt, publications: fusion };
  await saveIndex(INDEX_PATH, index);
  console.log(`   ✅ index écrit -> ${INDEX_PATH} (${fusion.length} publications)`);

  // Pas de sortie anticipée ici : un process.exit() dans un try ne déroule pas
  // la pile et sauterait le finally ci-dessous (donc client.close()). On laisse
  // l'exécution atteindre naturellement la fin du bloc try.
  if (INDEX_ONLY) {
    console.log("--index : arrêt après l'index.");
  } else {
    // ---- 2) Téléchargement des publications manquantes ---------------------
    const total = fusion.length;
    let faits = 0, sautes = 0, vides = 0;

    for (const pub of fusion) {
      const path = join(DIR, `${pub.date}.json`);
      if (existsSync(path) && !FORCE) { sautes++; continue; }

      const data = await fetchPublication(client, {
        publicationId: pub.publicationId,
        depth: DEFAULT_DEPTH,
      });

      // Une publication vide (les 5 disciplines à 0 ligne) n'est pas écrite :
      // l'API répond parfois total:0/data:[] en HTTP 200 pour un publicationId
      // qu'elle ne sert pas, et l'idempotence des deux writers repose sur
      // l'existence du fichier — l'écrire figerait le manque pour toujours.
      const ecrite = await savePublication(DIR, pub, data);
      if (!ecrite) {
        vides++;
        console.log(`   ${faits + sautes + vides}/${total} ⚠️  ${pub.date} (S${pub.week}) id ${pub.publicationId} — publication vide, ignorée (reprise au run suivant)`);
        continue;
      }

      const lignes = Object.values(data.disciplines).reduce((a, r) => a + r.length, 0);
      faits++;
      console.log(`   ${faits + sautes + vides}/${total} ✓ ${pub.date} (S${pub.week}) id ${pub.publicationId} — ${lignes} lignes`);
    }

    console.log(`\n✅ terminé : ${faits} téléchargées, ${sautes} déjà présentes, ${vides} vide(s) ignorée(s), ${total} au total.`);
  }
} finally {
  await client.close();
}
