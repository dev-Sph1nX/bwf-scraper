// tools/flashscore/backfill-points.mjs
// Backfill du POINT PAR POINT Flashscore, pour tous les matchs déjà connus du
// projet (ceux qui portent un fsId dans data/flashscore/odds/).
//
//   node tools/flashscore/backfill-points.mjs                 # tout, reprise automatique
//   node tools/flashscore/backfill-points.mjs open-de-malaisie-2024 …
//   node tools/flashscore/backfill-points.mjs --skip-existing # ignore les tournois déjà complets
//   node tools/flashscore/backfill-points.mjs --limit=50      # sonde rapide
//
// COLLECTE UNIQUE, pas incrémentale : le point par point d'un match joué ne
// changera plus. Le script est fait pour être relancé après interruption sans
// rien re-télécharger (cf. « reprise » plus bas).
//
// ENDPOINT (établi par sonde le 2026-08-28) :
//   GET https://global.flashscore.ninja/2/x/feed/df_mh_1_<fsId>
//   en-têtes `x-fsign: SW9D1eZo` + User-Agent de navigateur.
//   ⚠ L'ancien hôte d.flashscore.com/x/feed/… répond « 0 » pour tout : mort.
//
// Le décodage du flux (format, conventions, refus de combler les trous) vit
// dans lib/flashscore-points.mjs, testé hors ligne par
// test/flashscore-points.test.mjs. Ce script-ci ne fait que tirer et ranger.
//
// PRODUIT, un fichier par tournoi data/flashscore/points/<slug>.json (versionné,
// c'est LE fruit durable des 2 h de collecte). Par manche, deux chaînes de
// caractères parallèles, un caractère par point :
//   m : le marqueur   ("12211…")   s : le serveur ("11221…", 0 = non servi)
// Le score après chaque point se recalcule en comptant les 1 et les 2 — c'est
// vérifié à l'écriture contre HC/HE, et tout point dont l'écart n'est pas un
// +1 propre est consigné dans `anomalies` (le match est alors publié avec ses
// scores bruts, à charge de l'export de le rejeter).
//
// REPRISE : deux niveaux. (1) le fichier tournoi est réécrit tous les 25 matchs,
// donc une interruption coûte au pire 25 requêtes ; (2) chaque réponse brute est
// cachée dans data/flashscore/points/raw/<fsId>.txt (NON versionné, régénérable)
// — un re-décodage après correction du décodeur est alors gratuit et hors ligne.
//
// Politesse : séquentiel, ~500 ms entre deux appels, User-Agent réel, 3 essais
// avec attente croissante. Même régime que backfill-odds/backfill-sets.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decoder } from "../../lib/flashscore-points.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = join(ROOT, "data", "flashscore", "odds");
const OUT_DIR = join(ROOT, "data", "flashscore", "points");
const RAW_DIR = join(OUT_DIR, "raw");

const args = process.argv.slice(2);
const SKIP_EXISTING = args.includes("--skip-existing");
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity;
const ONLY = args.filter((a) => !a.startsWith("--"));

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const FSIGN = "SW9D1eZo";
const PAUSE_MS = 500;
const SAUVE_TOUS = 25; // matchs entre deux écritures du fichier tournoi

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Récupère le flux point par point d'un match. Rend le texte brut. */
async function getFeed(fsId, essais = 3) {
  for (let i = 1; i <= essais; i++) {
    try {
      const resp = await fetch(`https://global.flashscore.ninja/2/x/feed/df_mh_1_${fsId}`, {
        headers: { "x-fsign": FSIGN, "User-Agent": UA, Accept: "*/*" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      if (i === essais) throw e;
      await pause(1500 * i);
    }
  }
}

// ---------------------------------------------------------------------------
// 1) Univers des matchs à collecter : les fsId de data/flashscore/odds/.
//    C'est la source interne canonique (12 966 matchs, sur-ensemble strict des
//    12 528 fs_id d'export/cotes.csv, qui ne garde que les matchs appariés au
//    calendrier BWF). On collecte large : l'appariement est l'affaire de
//    l'export, et un match non apparié aujourd'hui peut l'être demain.
// ---------------------------------------------------------------------------
await mkdir(RAW_DIR, { recursive: true });

const fichiers = (await readdir(SRC_DIR))
  .filter((n) => n.endsWith(".json") && !n.startsWith("_"))
  .sort();

const tournois = [];
for (const nom of fichiers) {
  const slug = nom.replace(/\.json$/, "");
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const f = JSON.parse(await readFile(join(SRC_DIR, nom), "utf8"));
  const ids = [...new Set((f.matches || []).map((m) => m.fsId).filter(Boolean))];
  if (ids.length) tournois.push({ slug, ids });
}
const totalMatchs = tournois.reduce((s, t) => s + t.ids.length, 0);
console.log(`${tournois.length} tournois, ${totalMatchs} matchs à couvrir.`);

/** Lit le cache brut d'un fsId (rend null s'il n'y est pas). */
async function cacheLire(fsId) {
  try { return await readFile(join(RAW_DIR, `${fsId}.txt`), "utf8"); } catch { return null; }
}

const T0 = Date.now();
let faits = 0, tirés = 0, cachés = 0, vides = 0, erreurs = 0, anomales = 0;

for (const t of tournois) {
  const dest = join(OUT_DIR, `${t.slug}.json`);
  /** @type {Map<string, object>} déjà collecté (reprise) */
  const connus = new Map();
  try {
    const dejaLa = JSON.parse(await readFile(dest, "utf8"));
    for (const m of dejaLa.matches || []) connus.set(m.fsId, m);
  } catch { /* premier passage sur ce tournoi */ }
  if (SKIP_EXISTING && t.ids.every((id) => connus.has(id))) {
    console.log(`⏭  ${t.slug} — déjà complet (${connus.size})`);
    faits += t.ids.length;
    continue;
  }

  const ecrire = async () => {
    const matches = t.ids.map((id) => connus.get(id)).filter(Boolean);
    await writeFile(dest, JSON.stringify({
      source: "flashscore df_mh_1 (point par point)",
      fetchedAt: new Date().toISOString(),
      tournamentSlug: t.slug,
      // Rappel du contrat de lecture, pour qui ouvre le fichier seul.
      format: "par manche : m = marqueur de chaque point (1 = home, 2 = away), " +
              "s = serveur du point (0 = non servi par le flux) ; fin = [home, away] " +
              "à la fin de la manche. Orientation FLASHSCORE (home/away), PAS team1/team2.",
      stats: {
        matchs: t.ids.length,
        avecPoints: matches.filter((m) => m.sets).length,
        sansDonnees: matches.filter((m) => m.sets === null).length,
        avecAnomalie: matches.filter((m) => m.anomalies?.length).length,
      },
      matches,
    }, null, 1));
  };

  let depuisSauve = 0;
  for (const fsId of t.ids) {
    if (connus.has(fsId)) { faits++; continue; }
    if (faits >= LIMIT) break;

    let txt = await cacheLire(fsId);
    if (txt !== null) cachés++;
    else {
      await pause(PAUSE_MS);
      try {
        txt = await getFeed(fsId);
        await writeFile(join(RAW_DIR, `${fsId}.txt`), txt);
        tirés++;
      } catch (e) {
        // Échec réseau définitif : RIEN n'est écrit (ni cache, ni fiche) pour
        // que la prochaine exécution le retente. Un match manquant vaut mieux
        // qu'un match faussement marqué « sans données ».
        erreurs++;
        console.log(`   ⚠ ${fsId} : ${e.message}`);
        faits++;
        continue;
      }
    }

    const d = decoder(txt);
    if (!d) vides++;
    else if (d.anomalies.length) anomales++;
    connus.set(fsId, d
      ? { fsId, sets: d.sets, ...(d.anomalies.length ? { anomalies: d.anomalies } : {}) }
      : { fsId, sets: null });

    faits++;
    if (++depuisSauve >= SAUVE_TOUS) { await ecrire(); depuisSauve = 0; }
    if (faits % 250 === 0) {
      const parSec = faits / ((Date.now() - T0) / 1000);
      const reste = Math.round((totalMatchs - faits) / Math.max(parSec, 0.01) / 60);
      console.log(`   … ${faits}/${totalMatchs} (${tirés} tirés, ${cachés} en cache, ${vides} sans données) — reste ~${reste} min`);
    }
  }
  await ecrire();
  console.log(`✅ ${t.slug} — ${connus.size}/${t.ids.length} matchs`);
  if (faits >= LIMIT) { console.log("(--limit atteint)"); break; }
}

console.log(
  `\n${faits} matchs traités : ${tirés} téléchargés, ${cachés} relus du cache, ` +
  `${vides} sans point par point, ${anomales} avec anomalie, ${erreurs} en erreur réseau.`,
);
console.log(`Sortie : data/flashscore/points/ — puis « node tools/export-points.mjs ».`);
