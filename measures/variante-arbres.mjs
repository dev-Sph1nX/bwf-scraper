// measures/variante-arbres.mjs
// VARIANTES « ARBRES BOOSTÉS » — le test définitif du chapitre modèle
// (convenu le 2026-08-18) : un GBM (measures/gbm.mjs) reçoit TOUTES les
// features mesurées et cherche seul les interactions non linéaires que le
// modèle additif ne peut pas voir (indice qu'il en existe peut-être : la
// relation 3 sets ↔ ΔElo est non monotone, journal §10.1).
//
// Deux formes :
//   arbres-residuel  les arbres partent du LOGIT DE LA PRODUCTION
//                    (elo-recalibré) en offset et n'apprennent que ce qu'elle
//                    rate — LE test des interactions cachées, directement
//                    comparable à la référence ;
//   arbres-brut      les arbres seuls, sans la base Elo en offset (contrôle :
//                    s'il battait le résiduel, la base serait le problème).
//
// FEATURES (tout vient des helpers existants, convention de lib/features.mjs :
// un signal absent vaut 0, valeur neutre honnête) :
//   ΔElo, Elo moyen du match (niveau, proxy de la catégorie de tournoi),
//   signal marge de points (écart de logit Elo-bis §2.8 vs Elo), écart d'âge,
//   écart de gaucherie, camp à domicile, discipline en one-hot.
// Classement mondial et catégorie : pas joignables dans le banc sans nouveau
// chantier — écartés (l'Elo et le niveau moyen les couvrent largement).
//
// MARCHE AVANT STRICTE : un modèle par année jugée Y, entraîné sur les matchs
// d'années STRICTEMENT antérieures (tous les matchs prédictibles, cotes non
// requises). 2024 sans antériorité -> la variante rend la proba de production
// telle quelle. À JUGER SUR --annees=2025,2026.
//
// HYPERPARAMÈTRES FIGÉS, PAS DE BOUCLE DE TUNING : les valeurs par défaut
// raisonnables ci-dessous, choisies AVANT de voir le moindre résultat. Les
// tuner « jusqu'à ce que ça marche » serait une sélection déguisée — l'enjeu
// est de fermer la question, pas de gagner (§10.9 : le péage des books FR
// resterait infranchissable de toute façon).

import { eloProb } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { loadBirthdates, ageGap } from "./variante-age.mjs";
import { loadHands, handGap } from "./variante-hand.mjs";
import { homeSign } from "./variante-terrain.mjs";
import { pBisOf } from "./variante-elo-points.mjs";
import { fitGBM, predictGBM } from "./gbm.mjs";

const HYPER = { trees: 200, depth: 3, lr: 0.1, minLeaf: 50, lambda: 1 };
const MIN_TRAIN = 2000; // en dessous : pas de modèle, la variante rend la base
const DISCS = ["MS", "WS", "MD", "WD", "XD"];

const logit = (p) => Math.log(p / (1 - p));
const clamp = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const baseProd = (r) => clamp(recalibrate(eloProb(r.eloA, r.eloB), r.disc));

/** La ligne du banc -> vecteur de features du GBM (ordre fixe). */
function featuresOf(r, ctx) {
  const pElo = clamp(eloProb(r.eloA, r.eloB));
  return [
    (r.eloA - r.eloB) / 400,                    // ΔElo
    ((r.eloA + r.eloB) / 2 - 1500) / 400,       // niveau du match
    logit(clamp(pBisOf(r))) - logit(pElo),      // marge de points (§2.8), orthogonalisée
    ageGap(r, ctx.dob) ?? 0,                    // écart d'âge (années)
    handGap(r, ctx.hand) ?? 0,                  // écart de gaucherie
    homeSign(r),                                // +1/-1 camp à domicile, 0 sinon
    ...DISCS.map((d) => (r.disc === d ? 1 : 0)),
  ];
}

function makeVariante({ key, label, residuel }) {
  return {
    key, label, actif: false,
    prepare(allRows) {
      const ctx = { dob: loadBirthdates(), hand: loadHands() };
      this._ctx = ctx;
      this._models = new Map(); // année jugée -> modèle entraîné sur les années < Y
      const years = [...new Set(allRows.map((r) => r.year))].sort();
      for (const Y of years) {
        const past = allRows.filter((r) => r.year < Y);
        if (past.length < MIN_TRAIN) continue;
        const t0 = Date.now();
        const X = past.map((r) => featuresOf(r, ctx));
        const y = past.map((r) => (r.winner === 1 ? 1 : 0));
        const offsets = residuel ? past.map((r) => logit(baseProd(r))) : null;
        this._models.set(Y, fitGBM(X, y, { ...HYPER, offsets }));
        console.log(
          `   [${key}] modèle ${Y} : entraîné sur ${past.length} matchs < ${Y} ` +
          `(${HYPER.trees} arbres prof. ${HYPER.depth}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
        );
      }
    },
    p(r) {
      const m = this._models.get(r.year);
      const base = baseProd(r);
      if (!m) return base; // aucune antériorité : la production telle quelle
      return predictGBM(m, featuresOf(r, this._ctx), residuel ? logit(base) : 0);
    },
  };
}

export function makeVariantesArbres() {
  return [
    makeVariante({ key: "arbres-residuel", label: "arbres-residuel (GBM)", residuel: true }),
    makeVariante({ key: "arbres-brut", label: "arbres-brut (GBM)", residuel: false }),
  ];
}
