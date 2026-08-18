// measures/variante-elo-points.mjs
// VARIANTES DU BANC D'ESSAI — « Elo-bis à marge de points » (journal §2.8, lot C n°0).
//
// Ce que fait l'Elo-bis : au lieu de ne compter que victoire/défaite, la mise à
// jour de la note est modulée par la DOMINATION AUX POINTS — un 21-5 met à jour
// plus fort qu'un 21-19 — avec l'amortissement anti-autocorrélation façon
// FiveThirtyEight (une victoire large du favori annoncé apporte peu d'info
// nouvelle et compte moins que la même victoire par l'outsider). Moteur :
// `pointsFactor` de lib/elo.mjs (0 en production, inchangé ici).
//
// Paramètres FIGÉS = la meilleure config de la grille §2.8, réglée sur
// 2024-2025 : pointsFactor 1,5 + amorti, marge de référence mesurée sur les
// données (part de points du vainqueur − 0,5, ≈ 0,078) comme dans
// measures/mesure-elo-points.mjs. On ne re-règle RIEN ici : le banc juge la
// config déjà choisie, sinon on recommencerait une sélection déguisée.
//
// Deux variantes exportées (à activer via --variantes=… ou --toutes) :
//   elo-points-brut      la probabilité Elo-bis telle quelle ;
//   elo-points-recal-wf  la même, recalibrée par discipline en MARCHE AVANT —
//                        motif identique à recal-wf-5disc : l'année N est
//                        corrigée avec les années STRICTEMENT antérieures,
//                        facteur appliqué seulement si l'IC bootstrap exclut 1.
//                        Indispensable pour une comparaison loyale : la
//                        référence de production est recalibrée (§1.3) ;
//                        opposer un modèle calibré à un brut mélangerait
//                        « meilleure note » et « meilleure calibration ».
//
// Marche avant STRICTE : une seule passe chronologique de computeElo, dont le
// crochet onMatch livre les notes d'AVANT match (même mécanique que le banc et
// que la production). Le rejeu ne tourne que si une des variantes est demandée,
// pour ne pas ralentir les runs des autres variantes du banc.
//
// Limite assumée (documentée dans le compte-rendu) : la marge de référence est
// mesurée sur tout l'historique, comme dans §2.8. C'est un scalaire global du
// sport, pas un réglage par époque — on affiche aussi sa valeur hors 2026 pour
// montrer qu'il est stable et que ce « regard en arrière » ne porte rien.

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank, winnerPointShare } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { makeRng } from "../lib/metrics.mjs";

const KEYS = new Set(["elo-points-brut", "elo-points-recal-wf"]);
const SEED = 42;
const POINTS_FACTOR = 1.5;   // meilleure config §2.8 (grille sur 2024-2025)
const POINTS_DAMPING = true; // idem : « +amorti »

// Le rejeu (coûteux : une passe Elo complète) n'a lieu que si demandé.
const argVariantes = (process.argv.find((x) => x.startsWith("--variantes=")) || "").split("=")[1] || "";
const requested =
  process.argv.includes("--toutes") ||
  // les variantes COMBINÉES (variante-combinee.mjs) consomment aussi pBisOf
  argVariantes.split(",").filter(Boolean).some((k) => KEYS.has(k) || k.startsWith("combo"));

// Même identifiant d'entité que le banc (ids triés ; `pair:` en double).
const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};

let pBisByMatch = null; // clé `${tmtId}|${disc}|${matchTime}|${a}|${b}` -> proba Elo-bis (team1)

if (requested) {
  const init = loadInitialRanks();
  const seeds = {};
  for (const [disc, m] of Object.entries(init)) {
    const sm = new Map();
    for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
    seeds[disc] = sm;
  }
  const years = await store.listYears();

  // 1) Marge de référence, mesurée comme dans mesure-elo-points.mjs (part de
  //    points du vainqueur − 0,5, moyenne sur les matchs exploitables).
  let somme = 0, n = 0, sommeAvant26 = 0, nAvant26 = 0;
  await computeElo(years, seeds, {
    onMatch: ({ match }) => {
      if (isWalkover(match)) return;
      const s = winnerPointShare(match.score, match.winner);
      if (s == null) return;
      somme += s - 0.5; n++;
      if (Number(String(match.matchTime || "9999").slice(0, 4)) < 2026) {
        sommeAvant26 += s - 0.5; nAvant26++;
      }
    },
  });
  const REF = somme / n;
  console.log(
    `[elo-points] marge de référence : ${REF.toFixed(4)} (${n} matchs ; ` +
    `hors 2026 : ${(sommeAvant26 / nAvant26).toFixed(4)} sur ${nAvant26} — stable)`,
  );

  // 2) Rejeu Elo-bis walk-forward : pointsFactor 1,5 + amorti (§2.8).
  pBisByMatch = new Map();
  let collisions = 0;
  await computeElo(years, seeds, {
    params: { pointsFactor: POINTS_FACTOR, pointsRef: REF, pointsDamping: POINTS_DAMPING },
    onMatch: ({ tmtId, disc, match, a, b }) => {
      if (!match.matchTime) return;
      const key = `${tmtId}|${disc}|${match.matchTime}|${entityId(a.players)}|${entityId(b.players)}`;
      if (pBisByMatch.has(key)) collisions++;
      pBisByMatch.set(key, 1 / (1 + 10 ** ((b.entity.rating - a.entity.rating) / 400)));
    },
  });
  console.log(
    `[elo-points] rejeu Elo-bis (pointsFactor ${POINTS_FACTOR}${POINTS_DAMPING ? " +amorti" : ""}) : ` +
    `${pBisByMatch.size} matchs${collisions ? ` — ⚠️ ${collisions} collisions de clé` : ""}`,
  );
}

/** Proba Elo-bis d'une ligne du banc. Un trou = passes non appariées : on CASSE. */
export function pBisOf(r) {
  const p = pBisByMatch?.get(`${r.tmtId}|${r.disc}|${r.t}|${r.a}|${r.b}`);
  if (p == null) {
    throw new Error(
      `[elo-points] match introuvable dans le rejeu Elo-bis (${r.tmtId}|${r.disc}|${r.t}) — ` +
      `les deux passes walk-forward divergent, protocole cassé`,
    );
  }
  return p;
}

// --- Recalibration en marche avant, sur les probas Elo-bis ---------------------
// Même procédé que fitStretchWalkForward du banc (Newton 1-D, garde-fou : le
// facteur n'est appliqué que si l'IC bootstrap à 200 tirages, graine 42, exclut
// 1 ; minimum 300 matchs d'antériorité ; 2024 reste sans correction). Recopié
// plutôt qu'importé : le banc est un script, l'importer l'exécuterait.
const CLAMP = (s) => Math.min(4, Math.max(0.25, s));
export function fitStretchWalkForwardBis(allRows) {
  const fit = (zs, ys) => {
    let s = 1;
    for (let it = 0; it < 25; it++) {
      let g = 0, h = 0;
      for (let i = 0; i < zs.length; i++) {
        const e = 1 / (1 + Math.exp(-s * zs[i]));
        g += (ys[i] - e) * zs[i];
        h -= e * (1 - e) * zs[i] * zs[i];
      }
      const step = g / h;
      s -= step;
      if (Math.abs(step) < 1e-8) break;
    }
    return CLAMP(s);
  };
  const zOf = (r) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, pBisOf(r)));
    return Math.log(p / (1 - p));
  };
  const table = new Map();
  const detail = [];
  const yearsSeen = [...new Set(allRows.map((r) => r.year))].sort();
  for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
    const dRows = allRows.filter((r) => r.disc === disc);
    for (const Y of yearsSeen) {
      const past = dRows.filter((r) => r.year < Y);
      if (past.length < 300) { table.set(`${disc}|${Y}`, 1); continue; }
      const zs = past.map(zOf);
      const ys = past.map((r) => (r.winner === 1 ? 1 : 0));
      const s = fit(zs, ys);
      const rng = makeRng(SEED);
      const boots = [];
      const bz = new Array(zs.length), by = new Array(zs.length);
      for (let d = 0; d < 200; d++) {
        for (let i = 0; i < zs.length; i++) {
          const j = (rng() * zs.length) | 0;
          bz[i] = zs[j]; by[i] = ys[j];
        }
        boots.push(fit(bz, by));
      }
      boots.sort((x, y) => x - y);
      const lo = boots[Math.floor(0.025 * boots.length)];
      const hi = boots[Math.floor(0.975 * boots.length)];
      const applied = lo <= 1 && hi >= 1 ? 1 : s; // 1 dans l'IC : rien de prouvé
      table.set(`${disc}|${Y}`, applied);
      detail.push({ disc, year: Y, n: past.length, fit: s, lo, hi, applied });
    }
  }
  return { table, detail };
}

export const stretchP = (p, s) => {
  if (s === 1 || p <= 1e-9 || p >= 1 - 1e-9) return p;
  const z = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-s * z));
};

/** Les deux variantes, au format VARIANTES du banc. */
export const VARIANTES_ELO_POINTS = [
  {
    key: "elo-points-brut", label: "elo-points-brut", actif: false,
    // Elo-bis §2.8 tel quel (pointsFactor 1,5 + amorti), sans recalibration.
    p: (r) => pBisOf(r),
  },
  {
    key: "elo-points-recal-wf", label: "elo-points-recal-wf", actif: false,
    // Elo-bis + recalibration par discipline en marche avant (motif
    // recal-wf-5disc) : la comparaison loyale contre la référence recalibrée.
    // À juger surtout sur --annees=2025,2026 (2024 n'a pas d'antériorité).
    prepare(allRows) {
      const { table, detail } = fitStretchWalkForwardBis(allRows);
      this._table = table; this._detail = detail;
    },
    p(r) { return stretchP(pBisOf(r), this._table.get(`${r.disc}|${r.year}`) ?? 1); },
  },
];
