// Fusion finale : Wikidata (vérifié) + API BWF -> players-birthdates.json / ambiguous.json / report.md
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = "/private/tmp/claude-501/-Users-lucasleperlier-Documents-bwf-scraper/30cbbb29-611a-4142-af78-2a5c6d40cecb/scratchpad/agents/birthdates";
const load = f => existsSync(`${DIR}/${f}`) ? JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) : {};

const players = JSON.parse(readFileSync(`${DIR}/players.json`, "utf8"));
const byId = new Map(players.map(p => [p.id, p]));
const matched = load("matched-wikidata.json");
const wdAmbiguous = load("ambiguous.json");
const bwfScraped = load("bwf-api-scraped.json");
const verify = load("bwf-verify.json");

const final = {};
const finalAmbiguous = {};
const stats = { wikidataExact: 0, wikidataProbableConfirmed: 0, wikidataProbableKept: 0,
  wikidataCorrectedByBwf: 0, bwf: 0, bwfResolvedAmbiguous: 0, ambiguous: 0, dobConflicts: 0 };

// 1) Appariements Wikidata, avec vérification API pour les "probable"
for (const [id, m] of Object.entries(matched)) {
  const entry = { name: m.name, country: m.country, dob: m.dob, hand: m.hand, source: "wikidata", confidence: m.confidence };
  const v = verify[id];
  if (m.confidence === "probable" && v && !v.error && v.dob) {
    if (v.dob === m.dob) {
      entry.confidence = "exact"; // confirmé par la fiche BWF (jointure par ID)
      stats.wikidataProbableConfirmed++;
    } else {
      // la fiche BWF (ID certain) contredit Wikidata (nom) -> la fiche BWF gagne
      entry.dob = v.dob;
      entry.hand = null; // la main venait de l'entité Wikidata désormais douteuse
      entry.source = "bwf";
      entry.confidence = "exact";
      stats.wikidataCorrectedByBwf++;
      stats.dobConflicts++;
    }
  } else if (m.confidence === "probable") {
    stats.wikidataProbableKept++;
  } else {
    stats.wikidataExact++;
  }
  final[id] = entry;
}

// 2) Ambigus Wikidata tranchés par l'API BWF
for (const [id, a] of Object.entries(wdAmbiguous)) {
  const v = verify[id];
  if (v && !v.error && v.dob) {
    // main : si un candidat Wikidata a la même dob, on peut récupérer sa main ? Trop fragile -> null.
    final[id] = { name: a.name, country: a.country, dob: v.dob, hand: null, source: "bwf", confidence: "exact" };
    stats.bwfResolvedAmbiguous++;
  } else {
    finalAmbiguous[id] = a;
    stats.ambiguous++;
  }
}

// 3) Scraping API BWF des non-appariés (jointure par ID -> exact)
for (const [id, s] of Object.entries(bwfScraped)) {
  if (final[id]) continue;
  if (s.error || !s.dob) continue;
  // garde-fou : l'API doit renvoyer le bon joueur
  if (s.apiId != null && String(s.apiId) !== String(id)) continue;
  const badDob = s.dob === "0000-00-00" || +s.dob.slice(0, 4) < 1950;
  if (badDob) continue;
  final[id] = { name: s.name, country: s.country, dob: s.dob, hand: s.hand ?? null, source: "bwf", confidence: "exact" };
  stats.bwf++;
}

writeFileSync(`${DIR}/players-birthdates.json`, JSON.stringify(final, null, 1));
writeFileSync(`${DIR}/ambiguous.json`, JSON.stringify(finalAmbiguous, null, 1));

// --- Couverture ---
const totPlayers = players.length;
const totApp = players.reduce((s, p) => s + p.matches, 0);
const ids = new Set(Object.keys(final));
const covApp = players.filter(p => ids.has(p.id)).reduce((s, p) => s + p.matches, 0);
const handCount = Object.values(final).filter(v => v.hand).length;
const bySource = {};
for (const v of Object.values(final)) bySource[v.source] = (bySource[v.source] || 0) + 1;
const byConf = {};
for (const v of Object.values(final)) byConf[v.confidence] = (byConf[v.confidence] || 0) + 1;

// top joueurs restants sans dob
const missing = players.filter(p => !ids.has(p.id)).sort((a, b) => b.matches - a.matches);

const pct = (a, b) => (100 * a / b).toFixed(1) + " %";
const report = `# Dates de naissance des joueurs BWF — rapport

Généré le ${new Date().toISOString().slice(0, 10)}.

## Couverture

| Mesure | Valeur |
|---|---|
| Joueurs dans les données (draws 2024-2026, dédupliqués par id) | ${totPlayers} |
| Joueurs avec date de naissance | ${ids.size} (${pct(ids.size, totPlayers)}) |
| **Couverture pondérée par apparitions en match** | **${covApp}/${totApp} (${pct(covApp, totApp)})** |
| Main dominante connue | ${handCount} joueurs |
| Cas ambigus non résolus | ${Object.keys(finalAmbiguous).length} |

La couverture pondérée est la métrique utile pour l'Elo : un joueur à 200 matchs pèse
100 fois plus qu'un joueur à 2 matchs dans les paires de matchs à prédire.

## Sources

| Source | Joueurs |
|---|---|
| Wikidata | ${bySource.wikidata || 0} |
| API BWF (extranet-lv.bwfbadminton.com) | ${bySource.bwf || 0} |

Confiance : ${byConf.exact || 0} \`exact\`, ${byConf.probable || 0} \`probable\`.

## Méthode

1. **Extraction** : parcours de \`data/<année>/<tournoi>/draw-*.json\` (668 fichiers,
   14 114 matchs), déduplication par \`id\`, tri par nombre d'apparitions.
2. **Wikidata en masse** : une requête SPARQL (P106 = joueur de badminton, P569 date de
   naissance ≥ 1970, P27 nationalité → code CIO P984, P552 main dominante, P3620 ID BWF).
   ${stats.wikidataExact + stats.wikidataProbableConfirmed + stats.wikidataProbableKept + stats.wikidataCorrectedByBwf} joueurs appariés :
   - **${stats.wikidataExact} par ID BWF (P3620)** : jointure directe sur l'identifiant
     numérique de nos données → \`exact\`, aucun risque d'homonyme.
   - ${stats.wikidataProbableConfirmed + stats.wikidataProbableKept + stats.wikidataCorrectedByBwf} par nom normalisé (accents, casse, ordre des mots trié) + pays
     (table BWF→CIO : ENG/SCO/WAL→GBR, AIN→RUS/BLR, HKG/MAC→+CHN…).
3. **Vérification des appariements par nom** via l'API BWF (\`vue-player-summary\`,
   jointure par ID donc certaine) : ${stats.wikidataProbableConfirmed} confirmés (promus \`exact\`),
   ${stats.wikidataCorrectedByBwf} contredits (la date BWF remplace celle de Wikidata),
   ${stats.wikidataProbableKept} non vérifiables (restent \`probable\`).
4. **Homonymes Wikidata** (même nom + même pays, ou tri de tokens identique type
   « KIM Min Seung » vs « Kim Seung-min ») : jamais forcés. ${stats.bwfResolvedAmbiguous} tranchés par l'API BWF,
   ${Object.keys(finalAmbiguous).length} restent dans \`ambiguous.json\`.
5. **Non-appariés** : les 150 plus actifs interrogés sur l'API BWF
   (\`vue-player-summary\` pour la date, \`vue-player-bio\` pour la main), via le
   \`BwfClient\` Playwright du projet (franchissement Cloudflare, même contexte
   navigateur, ~1,5 s entre appels). ${stats.bwf} dates récupérées.

## Limites

- **Main dominante** : couverte surtout via Wikidata (P552) ; \`vue-player-bio\` la
  renvoie presque toujours \`null\`. ${handCount}/${ids.size} joueurs seulement.
- **Joueurs restants sans date** (${missing.length}, ${pct(totApp - covApp, totApp)} des apparitions) : quasi tous
  peu actifs (${missing.filter(p => p.matches <= 4).length} ont ≤ 4 matchs). Les 10 plus actifs :
${missing.slice(0, 10).map(p => `  - ${p.nameDisplay} (${p.countryCode}, ${p.matches} matchs, id ${p.id})`).join("\n")}
  Ils sont tous récupérables par la même API BWF si besoin (script \`scrape-bwf-api.mjs\`,
  reprise incrémentale — il suffit d'augmenter la limite).
- Wikidata peut contenir des erreurs ; ${stats.dobConflicts} conflit(s) Wikidata/BWF détecté(s)
  sur l'échantillon vérifié (~${Object.keys(verify).length} joueurs), résolus en faveur de la fiche BWF.
- Dates à précision année/mois sur Wikidata : exclues du livrable (jamais de fausse
  précision) ; les joueurs concernés ont été re-tentés via l'API BWF.

## Fichiers

- \`players-birthdates.json\` — { id: { name, country, dob, hand, source, confidence } }
- \`ambiguous.json\` — cas douteux avec candidats et raison
- \`players.json\` — liste extraite (id, nom, pays, slug, nb matchs)
- Scripts : \`extract-players.mjs\`, \`fetch-wikidata.mjs\`, \`match.mjs\`,
  \`scrape-bwf-api.mjs\`, \`verify-probables.mjs\`, \`finalize.mjs\`
`;
writeFileSync(`${DIR}/report.md`, report);

console.log(JSON.stringify(stats, null, 1));
console.log(`FINAL: ${ids.size}/${totPlayers} players (${pct(ids.size, totPlayers)}), weighted ${pct(covApp, totApp)}, hand ${handCount}`);
console.log(`sources:`, JSON.stringify(bySource), `confidence:`, JSON.stringify(byConf));
console.log(`still missing top5:`, missing.slice(0, 5).map(p => `${p.nameDisplay}(${p.matches})`).join("; "));
