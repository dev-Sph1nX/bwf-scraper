// Étude de rentabilité des pronostics : simule des stratégies de mise PLATE
// (1 € par pari) sur les matchs joués disposant d'un prono ET de cotes.
// Module pur, aucune E/S : appelé par build-data.mjs, testé par test/roi.test.mjs.
// Spec : docs/superpowers/specs/2026-08-04-roi-etude-rentabilite-design.md.
//
// Une « ligne » = un match prono+coté :
//   { tmtId, name, disc, roundName, matchTime, team1, team2,  // affichage
//     prob,   // proba (team1) d'avant match, entier 0..100, déjà recalibrée
//     pick,   // camp prédit : 1 | 2
//     winner, // vainqueur réel : 1 | 2
//     books } // { betclic|unibet|winamax: { odd1, odd2, open1?, open2? } }
// Les cotes d'ouverture n'existent que via Flashscore ; nos relevés maison
// n'ont que la clôture — chaque instant se traite donc indépendamment.

import { ev } from "./ev.mjs";
import { makeRng } from "./metrics.mjs";

export const BOOKS = ["betclic", "unibet", "winamax"];
export const INSTANTS = ["open", "close"];
export const EV_THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2];
export const BANDS = ["50-60", "60-70", "70-80", "80-90", "90-100"];

/** Meilleure cote d'un camp à un instant (ou celle d'un seul bookmaker). */
export function bestOddAt(books, side, instant, onlyBook = null) {
  const field = (instant === "close" ? "odd" : "open") + side;
  let best = null;
  for (const [book, b] of Object.entries(books || {})) {
    if (onlyBook && book !== onlyBook) continue;
    const odd = b?.[field];
    if (odd > 1 && (!best || odd > best.odd)) best = { odd, book };
  }
  return best;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Règle le pari : gain = cote − 1 si le camp misé gagne, −1 sinon.
 *  rowProb (proba team1) voyage avec le pari : les tranches de confiance
 *  de computeRoi en ont besoin sans retour à la ligne d'origine. */
const settle = (row, side, b) => ({
  side, odd: b.odd, book: b.book, rowProb: row.prob,
  won: row.winner === side,
  gain: row.winner === side ? round2(b.odd - 1) : -1,
});

/** Proba (0..1) d'un camp, depuis la proba team1 entière. */
const probOf = (row, side) => (side === 1 ? row.prob : 100 - row.prob) / 100;

/** Stratégie « favori » : 1 € sur notre pick, si sa cote existe à cet instant. */
export function favoriBets(row, instant, onlyBook = null) {
  const b = bestOddAt(row.books, row.pick, instant, onlyBook);
  return b ? [settle(row, row.pick, b)] : [];
}

/** Stratégie « value » : 1 € sur chaque camp dont EV = cote × p − 1 > seuil.
 *  Le pari porte son EV : le balayage de seuils refiltre sans re-simuler. */
export function valueBets(row, instant, { threshold = 0, onlyBook = null } = {}) {
  const out = [];
  for (const side of [1, 2]) {
    const b = bestOddAt(row.books, side, instant, onlyBook);
    if (!b) continue;
    const e = ev(b.odd, probOf(row, side));
    if (e != null && e > threshold) out.push({ ...settle(row, side, b), ev: e });
  }
  return out;
}

/** Stratégie « désaccord » : notre favori est l'outsider du marché (cote > 2). */
export function disagreementBets(row, instant) {
  const b = bestOddAt(row.books, row.pick, instant);
  return b && b.odd > 2 ? [settle(row, row.pick, b)] : [];
}

const round4 = (v) => Math.round(v * 10000) / 10000;

/** Agrégat d'une liste de paris : ROI ponctuel + IC 95 % par bootstrap
 *  (rééchantillonnage des paris avec remise, graine fixe -> reproductible). */
export function aggregate(bets, { draws = 500, seed = 42 } = {}) {
  const n = bets.length;
  if (!n) return { n: 0, staked: 0, net: 0, roi: null, ci: null, won: 0 };
  const net = bets.reduce((s, b) => s + b.gain, 0);
  const won = bets.reduce((s, b) => s + (b.won ? 1 : 0), 0);
  const rng = makeRng(seed);
  const rois = new Array(draws);
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += bets[(rng() * n) | 0].gain;
    rois[d] = s / n;
  }
  rois.sort((a, b) => a - b);
  const lo = rois[Math.floor(0.025 * (draws - 1))];
  const hi = rois[Math.ceil(0.975 * (draws - 1))];
  return { n, staked: n, net: round2(net), roi: round4(net / n), ci: [round4(lo), round4(hi)], won };
}

/** Tranche de confiance d'une proba de pick (50..100). */
const bandOf = (pickProb) => BANDS[Math.min(Math.floor((pickProb - 50) / 10), BANDS.length - 1)];

/** Le rapport complet de l'étude de rentabilité (cf. spec du 2026-08-04). */
export function computeRoi(rows, { draws = 500, seed = 42 } = {}) {
  const usable = rows.filter((r) =>
    r.prob != null && (r.winner === 1 || r.winner === 2) &&
    r.books && Object.keys(r.books).length > 0);
  const opts = { draws, seed };

  // Journal auditable : chaque pari des stratégies principales, aux 2 instants.
  const betLog = [];
  const logged = (row, strategy, instant, bets) => {
    for (const b of bets) betLog.push({
      tmtId: row.tmtId, disc: row.disc, roundName: row.roundName,
      matchTime: row.matchTime, team1: row.team1, team2: row.team2,
      prob: row.prob, strategy, instant, side: b.side, book: b.book,
      odd: b.odd, ev: b.ev != null ? round4(b.ev) : null, won: b.won, gain: b.gain,
    });
    return bets;
  };

  // --- analyses 1-2 : favori et value, par tournoi + global ---
  const gen = {
    favori: (r, instant) => favoriBets(r, instant),
    value: (r, instant) => valueBets(r, instant),
  };
  const allBets = { favori: { open: [], close: [] }, value: { open: [], close: [] } };
  const tmtIds = [...new Set(usable.map((r) => r.tmtId))];
  const strategies = {};
  for (const key of Object.keys(gen)) {
    const tournois = [];
    for (const tmtId of tmtIds) {
      const tRows = usable.filter((r) => r.tmtId === tmtId);
      const entry = {
        tmtId, name: tRows[0].name,
        firstDay: tRows.map((r) => String(r.matchTime || "")).sort()[0].slice(0, 10) || null,
      };
      for (const instant of INSTANTS) {
        const bets = tRows.flatMap((r) => logged(r, key, instant, gen[key](r, instant)));
        allBets[key][instant].push(...bets);
        entry[instant] = aggregate(bets, opts);
      }
      tournois.push(entry);
    }
    tournois.sort((a, b) => String(a.firstDay).localeCompare(String(b.firstDay)));
    strategies[key] = {
      global: {
        open: aggregate(allBets[key].open, opts),
        close: aggregate(allBets[key].close, opts),
      },
      tournois,
    };
  }

  // --- analyse 3 : ROI du pari « favori » par tranche de confiance ---
  const bands = BANDS.map((band) => ({ band }));
  for (const instant of INSTANTS) {
    const groups = new Map(BANDS.map((b) => [b, []]));
    for (const bet of allBets.favori[instant]) {
      groups.get(bandOf(bet.side === 1 ? bet.rowProb : 100 - bet.rowProb)).push(bet);
    }
    for (const e of bands) e[instant] = aggregate(groups.get(e.band), opts);
  }

  // --- analyse 4 : balayage du seuil d'EV (refiltre les paris value, ev connu) ---
  const evSweep = EV_THRESHOLDS.map((threshold) => {
    const e = { threshold };
    for (const instant of INSTANTS) {
      e[instant] = aggregate(allBets.value[instant].filter((b) => b.ev > threshold), opts);
    }
    return e;
  });

  // --- analyse 5 : désaccord avec le marché ---
  const disagreement = {};
  for (const instant of INSTANTS) {
    const bets = usable.flatMap((r) => logged(r, "desaccord", instant, disagreementBets(r, instant)));
    disagreement[instant] = aggregate(bets, opts);
  }

  // --- analyse 6 : chaque bookmaker seul, sur tous ses matchs ET sur le
  // panier commun (matchs où les 3 cotent les deux camps à cet instant) ---
  const hasAll = (row, instant) =>
    BOOKS.every((bk) => bestOddAt(row.books, 1, instant, bk) && bestOddAt(row.books, 2, instant, bk));
  const byBook = BOOKS.map((book) => {
    const entry = { book };
    for (const key of Object.keys(gen)) {
      const mk = (r, instant) => key === "favori"
        ? favoriBets(r, instant, book)
        : valueBets(r, instant, { onlyBook: book });
      entry[key] = { all: {}, common: {} };
      for (const instant of INSTANTS) {
        entry[key].all[instant] = aggregate(usable.flatMap((r) => mk(r, instant)), opts);
        entry[key].common[instant] =
          aggregate(usable.filter((r) => hasAll(r, instant)).flatMap((r) => mk(r, instant)), opts);
      }
    }
    return entry;
  });

  return { totalMatches: usable.length, strategies, bands, evSweep, disagreement, byBook, bets: betLog };
}
