// tools/export-points.mjs
// EXPORT DU POINT PAR POINT — un CSV plat, une ligne par point joué, aligné sur
// export/matches.csv (même match_id, même orientation équipe 1 / équipe 2).
//
//   node tools/export-points.mjs                       # -> export/points.csv
//   node tools/export-points.mjs --out=../bwf-playground
//   node tools/export-points.mjs --src=../bwf-playground   # autre matches/cotes de référence
//   node tools/export-points.mjs --garder-troues       # inclut les matchs à trous (déconseillé)
//
// ENTRÉES : data/flashscore/points/*.json (collecté par
// tools/flashscore/backfill-points.mjs) + export/matches.csv et export/cotes.csv
// (produits par `npm run export`, qui portent le pont fs_id ↔ match_id).
//
// COLONNES :
//   match_id   clé de export/matches.csv
//   fs_id      identifiant Flashscore du match
//   set        numéro de manche (1, 2, 3)
//   num_point  rang du point DANS la manche (1…n)
//   score1     points de l'équipe 1 APRÈS ce point
//   score2     points de l'équipe 2 après ce point
//   marqueur   1 ou 2 — le camp qui vient de marquer
//   serveur    1, 2, ou vide — le camp qui SERVAIT ce point
//
// POURQUOI `serveur` ET PAS `serie`. Le flux porte bien un champ de « série »
// (HI/HJ), mais la sonde de conventions l'a mesuré strictement égal à l'écart
// au score sur 1 877/1 877 points : il se recalcule par `score1 - score2` et
// n'apporte rien. Le champ HG, lui, dit qui servait — déductible du point
// précédent à l'intérieur d'une manche (le service revient au gagnant du
// rallye), mais PAS au premier point d'une manche, où il est la seule trace de
// qui a engagé. C'est donc lui qu'on publie.
//
// ORIENTATION, ET COMMENT ELLE EST ÉTABLIE. Flashscore raisonne en home/away,
// nous en équipe 1 / équipe 2, et l'un n'est pas l'autre. Plutôt que de faire
// confiance à un appariement de noms, on RECONSTRUIT le score de chaque manche
// depuis les points et on le confronte à la colonne `score` de matches.csv,
// dans les deux sens. Le sens qui colle est le bon — et il ne peut jamais y
// avoir d'ambiguïté : le vainqueur du match diffère d'un sens à l'autre, donc
// au plus un des deux peut coller. Un match dont aucun sens ne colle est
// EXCLU et compté. La validation et l'orientation sont ainsi le même geste.
//
// MATCHS À TROUS : quand le flux Flashscore saute des points (constaté : un
// score qui passe de 15-10 à 18-10), les scores finaux restent justes mais la
// séquence est incomplète. Ces matchs sont exclus par défaut : une analyse de
// dynamique de match ne doit pas travailler sur une séquence trouée sans le
// savoir. `--garder-troues` les réintègre pour qui accepte le compromis.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => (process.argv.find((x) => x.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const SRC_DIR = arg("src") || join(ROOT, "export");
const OUT_DIR = arg("out") || join(ROOT, "export");
const PTS_DIR = join(ROOT, "data", "flashscore", "points");
const GARDER_TROUES = process.argv.includes("--garder-troues");

const COLS = ["match_id", "fs_id", "set", "num_point", "score1", "score2", "marqueur", "serveur"];

/** Lecteur CSV RFC 4180 (les libellés de tournoi contiennent des virgules). */
function lireCsv(txt) {
  const lignes = [];
  let champ = "", ligne = [], cite = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (cite) {
      if (c === '"') { if (txt[i + 1] === '"') { champ += '"'; i++; } else cite = false; }
      else champ += c;
    } else if (c === '"') cite = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ); champ = ""; lignes.push(ligne); ligne = []; }
    else if (c !== "\r") champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const entete = lignes.shift();
  const idx = Object.fromEntries(entete.map((h, i) => [h, i]));
  return { lignes: lignes.filter((l) => l.length > 1), idx };
}

// ---------------------------------------------------------------------------
// 1) Référence : les matchs BWF et leur score, le pont fs_id ↔ match_id.
// ---------------------------------------------------------------------------
const m = lireCsv(await readFile(join(SRC_DIR, "matches.csv"), "utf8"));
const matchs = new Map(); // match_id -> { saison, sets: [[p1,p2], …] }
for (const l of m.lignes) {
  matchs.set(l[m.idx.match_id], {
    saison: l[m.idx.saison],
    sets: l[m.idx.score].split(" ").filter(Boolean).map((s) => s.split("-").map(Number)),
  });
}

const c = lireCsv(await readFile(join(SRC_DIR, "cotes.csv"), "utf8"));
const matchDeFs = new Map(); // fs_id -> match_id
const conflits = new Set();
for (const l of c.lignes) {
  const fs = l[c.idx.fs_id], mid = l[c.idx.match_id];
  if (!fs || !mid) continue;
  const vu = matchDeFs.get(fs);
  if (vu && vu !== mid) conflits.add(fs);
  else matchDeFs.set(fs, mid);
}
console.log(`Référence : ${matchs.size} matchs, ${matchDeFs.size} fs_id appariés` +
  `${conflits.size ? ` (⚠ ${conflits.size} fs_id ambigus, écartés)` : ""}.`);
for (const fs of conflits) matchDeFs.delete(fs);

// ---------------------------------------------------------------------------
// 2) Point par point collecté.
// ---------------------------------------------------------------------------
let noms;
try {
  noms = (await readdir(PTS_DIR)).filter((n) => n.endsWith(".json"));
} catch {
  console.error("❌ data/flashscore/points/ absent — lancer d'abord tools/flashscore/backfill-points.mjs");
  process.exit(1);
}
const collectes = new Map(); // fsId -> fiche
for (const n of noms.sort()) {
  const f = JSON.parse(await readFile(join(PTS_DIR, n), "utf8"));
  for (const fiche of f.matches || []) collectes.set(fiche.fsId, fiche);
}

// ---------------------------------------------------------------------------
// 3) Validation + orientation + écriture.
// ---------------------------------------------------------------------------
const empreinte = (sets, swap) =>
  sets.map(([a, b]) => (swap ? `${b}-${a}` : `${a}-${b}`)).join(" ");

const bilan = {
  collectes: collectes.size,
  sansDonnees: 0,      // Flashscore n'a pas de point par point pour ce match
  sansMatchId: 0,      // pas apparié au calendrier BWF (pas de cote retenue)
  inconnuDeMatches: 0, // apparié, mais le match_id n'est pas dans matches.csv
  troues: 0,           // séquence incomplète (saut de score dans le flux)
  invalides: 0,        // score reconstruit ≠ score connu, dans aucun des deux sens
  exportes: 0,
  points: 0,
  swap: 0,
};
const invalides = [];
const parAnnee = new Map(); // saison -> { exportables, exportes }

const lignes = [COLS.join(",")];
for (const [fsId, fiche] of collectes) {
  if (!fiche.sets) { bilan.sansDonnees++; continue; }
  const mid = matchDeFs.get(fsId);
  if (!mid) { bilan.sansMatchId++; continue; }
  const ref = matchs.get(mid);
  if (!ref) { bilan.inconnuDeMatches++; continue; }

  const a = parAnnee.get(ref.saison) || { exportables: 0, exportes: 0 };
  a.exportables++; parAnnee.set(ref.saison, a);

  const sets = [...fiche.sets].sort((x, y) => x.no - y.no);
  const attendu = empreinte(ref.sets, false);
  const direct = empreinte(sets.map((s) => s.fin), false);
  const inverse = empreinte(sets.map((s) => s.fin), true);
  let swap;
  if (direct === attendu) swap = false;
  else if (inverse === attendu) swap = true;
  else {
    bilan.invalides++;
    if (invalides.length < 10) invalides.push(`${mid} (${fsId}) : flux ${direct} ≠ connu ${attendu}`);
    continue;
  }
  if (fiche.anomalies?.length) {
    bilan.troues++;
    if (!GARDER_TROUES) continue;
  }
  if (swap) bilan.swap++;

  for (const s of sets) {
    let p1 = 0, p2 = 0;
    for (let i = 0; i < s.m.length; i++) {
      // Orientation : sans swap, « home » Flashscore EST notre équipe 1.
      const marq = swap ? (s.m[i] === "1" ? "2" : "1") : s.m[i];
      const srv = s.s[i] === "0" ? "" : swap ? (s.s[i] === "1" ? "2" : "1") : s.s[i];
      if (marq === "1") p1++; else p2++;
      lignes.push([mid, fsId, s.no, i + 1, p1, p2, marq, srv].join(","));
      bilan.points++;
    }
  }
  bilan.exportes++;
  a.exportes++;
}

await mkdir(OUT_DIR, { recursive: true });
const dest = join(OUT_DIR, "points.csv");
await writeFile(dest, lignes.join("\n") + "\n");

// ---------------------------------------------------------------------------
// 4) Rapport — à l'écran ET dans points.md, à côté du CSV.
//
// Le dictionnaire de colonnes voyage avec le fichier : points.csv part dans un
// autre dépôt, où l'en-tête de ce script n'est pas lisible. Le rapport de
// couverture y est joint plutôt que laissé dans un terminal, parce qu'un chiffre
// de couverture sans date ni méthode ne se vérifie plus six mois après.
// ---------------------------------------------------------------------------
const couverture = [...parAnnee].sort().map(([an, v]) =>
  `| ${an} | ${v.exportes} | ${v.exportables} | ${((100 * v.exportes) / v.exportables).toFixed(1)} % |`);

const md = `# points.csv — le point par point des matchs BWF

Une ligne par point joué. Source : flux \`df_mh_1\` de Flashscore, collecté le
${new Date().toISOString().slice(0, 10)} par \`tools/flashscore/backfill-points.mjs\`
(dépôt bwf-scraper), exporté par \`tools/export-points.mjs\`.

## Colonnes

| colonne | contenu |
|---|---|
| \`match_id\` | clé de \`matches.csv\` — jointure directe |
| \`fs_id\` | identifiant Flashscore du match (aussi présent dans \`cotes.csv\`) |
| \`set\` | numéro de manche (1, 2, 3) |
| \`num_point\` | rang du point **dans la manche**, à partir de 1 |
| \`score1\` | points de l'**équipe 1** après ce point |
| \`score2\` | points de l'**équipe 2** après ce point |
| \`marqueur\` | \`1\` ou \`2\` — le camp qui vient de marquer |
| \`serveur\` | \`1\`, \`2\` ou vide — le camp qui **servait** ce point |

\`equipe1\`/\`equipe2\` sont celles de \`matches.csv\` : l'orientation est la même
dans les deux fichiers, y compris quand Flashscore désignait l'équipe 2 comme
« home » (${bilan.swap} matchs retournés à l'export).

## Ce qu'il faut savoir

- **\`serveur\` est la seule colonne non déductible du score.** À l'intérieur
  d'une manche le service revient au gagnant du rallye, donc
  \`serveur(n) = marqueur(n-1)\` — sauf au **premier point d'une manche**, où
  cette colonne dit qui a engagé. Le flux se contredit sur ~0,2 % des points
  (scories de saisie Flashscore) : la valeur est reproduite telle quelle,
  jamais recalculée.
- **Pas de colonne « série ».** Le flux porte un champ de série, mesuré
  strictement égal à \`score1 - score2\` sur 1 877 points de contrôle : il se
  recalcule, il n'est pas exporté.
- **Chaque match exporté a été validé** en reconstruisant le score de ses
  manches depuis les points et en le confrontant à la colonne \`score\` de
  \`matches.csv\`. Un match qui ne colle dans aucun des deux sens est exclu.
- **Les matchs à séquence trouée sont exclus** (${bilan.troues} matchs) : quand
  Flashscore saute des points, les scores finaux restent justes mais la
  séquence est incomplète, ce qui fausserait silencieusement toute analyse de
  dynamique.${GARDER_TROUES ? "\n  ⚠ CETTE SORTIE-CI a été produite avec `--garder-troues` : ils y SONT." : ""}
- **Un match absent n'est pas un match sans points** : la collecte ne couvre que
  les matchs déjà connus du dépôt via Flashscore (ceux qui portent un \`fs_id\`).

## Couverture

${bilan.collectes} matchs interrogés :

| | matchs |
|---|---|
| sans point par point chez Flashscore | ${bilan.sansDonnees} |
| sans \`match_id\` BWF (non apparié) | ${bilan.sansMatchId} |
| \`match_id\` absent de \`matches.csv\` | ${bilan.inconnuDeMatches} |
| séquence trouée | ${bilan.troues} |
| score reconstruit incohérent | ${bilan.invalides} |
| **exportés** | **${bilan.exportes}** (${bilan.points} points) |

| saison | exportés | appariés avec flux | couverture |
|---|---|---|---|
${couverture.join("\n")}
`;
await writeFile(join(OUT_DIR, "points.md"), md);


console.log(`\n=== Couverture du point par point ===`);
console.log(`  matchs collectés (flux interrogé)   ${bilan.collectes}`);
console.log(`  — sans point par point chez FS      ${bilan.sansDonnees}`);
console.log(`  — sans match_id BWF (non apparié)   ${bilan.sansMatchId}`);
console.log(`  — match_id absent de matches.csv    ${bilan.inconnuDeMatches}`);
console.log(`  — séquence trouée${GARDER_TROUES ? " (RÉINTÉGRÉS)" : "                 "}  ${bilan.troues}`);
console.log(`  — score reconstruit incohérent      ${bilan.invalides}`);
console.log(`  ✅ exportés                          ${bilan.exportes} matchs, ${bilan.points} points`);
console.log(`     (dont ${bilan.swap} en orientation inversée par rapport à Flashscore)`);
if (invalides.length) {
  console.log(`\n  Exemples d'incohérences :`);
  for (const x of invalides) console.log(`   · ${x}`);
}
console.log(`\n  Couverture par saison (matchs exportés / matchs appariés ayant un flux) :`);
for (const [an, v] of [...parAnnee].sort()) {
  const pct = ((100 * v.exportes) / v.exportables).toFixed(1);
  console.log(`   ${an}  ${String(v.exportes).padStart(5)} / ${String(v.exportables).padStart(5)}  ${pct.padStart(5)} %`);
}
console.log(`\n-> ${dest}`);
console.log(`-> ${join(OUT_DIR, "points.md")} (dictionnaire des colonnes + ce rapport)`);
