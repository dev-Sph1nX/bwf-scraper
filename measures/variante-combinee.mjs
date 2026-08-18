// measures/variante-combinee.mjs
// VARIANTES COMBINÉES — l'hypothèse du propriétaire (2026-08-18) : « plein de
// petits facteurs qui, ensemble, deviennent justes ».
//
// Chaque facteur du lot C n°0 a été jugé SEUL au banc, et chacun est tombé
// « non départageable » : âge M3 +0,9 pt [−0,6 ; +2,4], terrain +0,2 [−0,2 ;
// +0,5], Elo-points recalibré +2,2 [−1,1 ; +5,5]. Somme des estimations
// ponctuelles ≈ +3,3 pt, pour un écart à combler chiffré à ~4 pt (§8.2). Et si
// les effets sont réels et indépendants, ils s'additionnent quand leurs bruits
// ne croissent qu'en racine : la combinaison peut être départageable là où
// chaque pièce ne l'est pas. C'est la seule composition jamais testée.
//
// COMPOSITION, sur l'échelle logit (les corrections sont petites, l'addition
// des logits est le modèle additif exact pour des facteurs indépendants) :
//   logit(p) = logit(base) + b_âge(disc, année) × écart d'âge
//                          + (ln 10 / échelle) × H(année) × camp à domicile
// Deux bases :
//   combo-elo    : base = production (elo-recalibré) — mesure ce que âge +
//                  terrain ajoutent ENSEMBLE au modèle actuel ;
//   combo-points : base = elo-points-recal-wf — y ajoute en plus la marge de
//                  points, le facteur au meilleur M3 solo.
// La main dominante est EXCLUE : son estimation solo est nulle (§9.6, M3
// −0,1 pt) — l'inclure n'ajouterait que du bruit.
//
// AUCUN COEFFICIENT NOUVEAU : chaque facteur garde exactement son ajustement
// marche-avant et son verrou d'origine (appliqué seulement si l'IC exclut 0/1,
// année N ajustée sur les années < N). On ne réoptimise rien — on assemble.
// À juger sur --annees=2025,2026 (2024 n'a d'antériorité pour aucun facteur).

import { PARAMS } from "../lib/elo.mjs";
import { eloProb } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { loadBirthdates, ageGap, fitAgeWalkForward } from "./variante-age.mjs";
import { homeItems, fitHomeBonus, bootstrapHomeBonus, homeSign } from "./variante-terrain.mjs";
import { pBisOf, fitStretchWalkForwardBis, stretchP } from "./variante-elo-points.mjs";

const SINGLES = new Set(["MS", "WS"]);
const LOGIT_PAR_ELO = Math.LN10 / PARAMS.scale; // 1 pt d'Elo vaut ça en logit
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clamp = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));

/** Ajustements marche-avant partagés par les deux combinaisons. */
function prepareFacteurs(allRows, dobMap) {
  // Âge : b par discipline × année (verrou : IC excluant 0), comme elo-age.
  const { table: ageTable, detail: ageDetail } = fitAgeWalkForward(allRows, dobMap);
  // Terrain : H par année (simple seulement, verrou : IC excluant 0), comme elo-terrain.
  const items = homeItems(allRows);
  const homeTable = new Map();
  const homeDetail = [];
  for (const Y of [...new Set(allRows.map((r) => r.year))].sort()) {
    const past = items.filter((it) => it.year < Y);
    if (past.length < 100) { homeTable.set(Y, 0); continue; }
    const fit = fitHomeBonus(past);
    const [lo, hi] = bootstrapHomeBonus(past);
    const applied = lo <= 0 && hi >= 0 ? 0 : fit;
    homeTable.set(Y, applied);
    homeDetail.push({ disc: "simple (H terrain)", year: Y, n: past.length, fit, lo, hi, applied });
  }
  return { ageTable, homeTable, detail: [...ageDetail.map((d) => ({ ...d, disc: `${d.disc} (b âge/an)` })), ...homeDetail] };
}

/** Corrections additives (logit) d'une ligne, selon les tables ajustées. */
function corrections(r, { ageTable, homeTable }, dobMap) {
  let z = 0;
  const b = ageTable?.get(`${r.disc}|${r.year}`) ?? 0;
  if (b) {
    const d = ageGap(r, dobMap);
    if (d != null) z += b * d;
  }
  if (SINGLES.has(r.disc)) {
    const h = homeSign(r);
    const H = homeTable?.get(r.year) ?? 0;
    if (h && H) z += LOGIT_PAR_ELO * H * h;
  }
  return z;
}

export function makeVariantesCombinees() {
  const dobMap = loadBirthdates();
  return [
    {
      key: "combo-elo", label: "combo-elo (âge+terrain)", actif: false,
      prepare(allRows) {
        this._f = prepareFacteurs(allRows, dobMap);
        this._detail = this._f.detail;
      },
      p(r) {
        const base = clamp(recalibrate(eloProb(r.eloA, r.eloB), r.disc));
        return sigmoid(logit(base) + corrections(r, this._f, dobMap));
      },
    },
    {
      key: "combo-points", label: "combo-points (pts+âge+terrain)", actif: false,
      prepare(allRows) {
        this._f = prepareFacteurs(allRows, dobMap);
        const { table, detail } = fitStretchWalkForwardBis(allRows);
        this._stretch = table;
        this._detail = [...this._f.detail, ...detail];
      },
      p(r) {
        const base = clamp(stretchP(pBisOf(r), this._stretch.get(`${r.disc}|${r.year}`) ?? 1));
        return sigmoid(logit(base) + corrections(r, this._f, dobMap));
      },
    },
  ];
}
