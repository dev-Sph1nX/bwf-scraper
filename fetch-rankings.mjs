// fetch-rankings.mjs
// Synchronise l'historique du classement mondial BWF : récupère l'index des
// publications et télécharge celles dont le fichier manque dans data/rankings/.
//
//   node fetch-rankings.mjs            # synchronise (ne fait rien si à jour)
//   node fetch-rankings.mjs --force    # réécrit tous les fichiers de la fenêtre
//
// À lancer quotidiennement : la BWF publie une fois par semaine (le mardi), donc
// le script ne fera rien la plupart du temps. Il n'y a pas de test de fraîcheur
// sur l'heure d'exécution : l'idempotence vient de l'existence du fichier de la
// publication, c'est-à-dire de l'identité BWF elle-même.
//
// Un run manqué se rattrape tout seul : les publications absentes sont reprises
// au run suivant, tant qu'elles sont encore dans la fenêtre de 60 semaines de
// l'API.

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BwfClient } from "./lib/client.mjs";
import { fetchPublicationIndex, mergeIndex, loadIndex, saveIndex } from "./lib/publications.mjs";
import { fetchPublication, DEFAULT_DEPTH } from "./lib/rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, "data", "rankings");
const INDEX_PATH = join(DIR, "publications.json");

const FORCE = process.argv.slice(2).includes("--force");

const client = await new BwfClient().start();

try {
  const distant = await fetchPublicationIndex(client);
  const local = await loadIndex(INDEX_PATH);
  const fusion = mergeIndex(local?.publications ?? [], distant.publications);

  console.log(
    `Index : ${distant.publications.length} publications côté API, ` +
    `${fusion.length} après fusion avec l'archive locale.`,
  );

  const manquantes = fusion.filter((p) => FORCE || !existsSync(join(DIR, `${p.date}.json`)));

  // Pas de sortie anticipée ici : un process.exit() dans un try ne déroule pas
  // la pile et sauterait le finally ci-dessous (donc client.close()). On laisse
  // l'exécution atteindre naturellement la fin du bloc try.
  if (manquantes.length === 0) {
    console.log("⏭  Aucune publication manquante. Rien à faire.");
  } else {
    console.log(`${manquantes.length} publication(s) à télécharger : ${manquantes.map((p) => p.date).join(", ")}`);

    for (const pub of manquantes) {
      const data = await fetchPublication(client, {
        publicationId: pub.publicationId,
        depth: DEFAULT_DEPTH,
        onProgress: (c, n) => console.log(`   ✓ ${c} — ${n} lignes`),
      });
      await writeFile(join(DIR, `${pub.date}.json`), JSON.stringify({
        publicationId: pub.publicationId,
        date: pub.date,
        week: pub.week,
        year: pub.year,
        rankId: data.rankId,
        depth: data.depth,
        fetchedAt: data.fetchedAt,
        disciplines: data.disciplines,
      }), "utf8");
      console.log(`✅ écrit -> data/rankings/${pub.date}.json (S${pub.week}, id ${pub.publicationId})`);
    }
  }

  await saveIndex(INDEX_PATH, { source: distant.source, fetchedAt: distant.fetchedAt, publications: fusion });
  if (manquantes.length > 0) {
    console.log(`✅ index mis à jour : ${fusion.length} publications.`);
  }
} finally {
  await client.close();
}
