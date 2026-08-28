// lib/books-history.mjs
// Historisation des cotes bookmakers : relevés append-only (data/books/runs/)
// → séries temporelles par (opérateur, match) → regroupement inter-opérateurs.
//
// Même philosophie que lib/odds-history.mjs : la valeur est dans l'ÉVOLUTION
// (cote de clôture, sens du mouvement), donc les relevés ne sont jamais
// réécrits et les séries se reconstituent à la lecture.
//
// Spécificité bookmakers : un même match existe chez plusieurs opérateurs. Les
// trois portent l'identifiant Sportradar du match (srId) — la jointure est
// donc EXACTE, sans rapprochement de noms. Le flou ne reste nécessaire que
// pour l'orientation (quel camp est « 1 » chez chaque opérateur) et vers les
// matchs BWF.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { impliedP1, overround } from "./odds-history.mjs";
import { normalizeLabel } from "./odds.mjs";

/** Charge tous les relevés bookmakers, du plus ancien au plus récent. */
export async function loadBookRuns(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
    const r = JSON.parse(await readFile(join(dir, n), "utf8"));
    if (r?.fetchedAt && r?.books) runs.push(r);
  }
  return runs.sort((a, b) => String(a.fetchedAt).localeCompare(String(b.fetchedAt)));
}

/**
 * Séries temporelles par (opérateur, match). Les relevés consécutifs identiques
 * sont fusionnés (on garde `at` = première apparition, `lastSeen` = dernière).
 *
 * @param {Array<{fetchedAt: string, books: object}>} runs triés par date croissante
 * @returns {Array<object>} une entrée par (book, bookMatchId)
 */
export function buildBookSeries(runs) {
  const parCle = new Map();

  for (const run of runs) {
    for (const [book, data] of Object.entries(run.books || {})) {
      for (const m of data?.rows || []) {
        if (!m.bookMatchId) continue;
        const cle = `${book}:${m.bookMatchId}`;
        let e = parCle.get(cle);
        if (!e) {
          e = {
            book, bookMatchId: m.bookMatchId, srId: m.srId ?? null,
            tournament: m.tournament, discipline: m.discipline,
            p1: m.p1, p2: m.p2, startUtc: m.startUtc, isLive: !!m.isLive,
            points: [],
          };
          parCle.set(cle, e);
        }
        // Les métadonnées suivent le dernier relevé (horaire précisé, passage
        // en live, srId apparu tardivement…).
        e.isLive = !!m.isLive;
        if (m.startUtc) e.startUtc = m.startUtc;
        if (m.srId) e.srId = m.srId;
        if (m.discipline) e.discipline = m.discipline;
        // Marchés annexes optionnels (sets, totaux — voir lib/books.mjs) : la
        // dernière photo PRÉMATCH fait foi, horodatée pour afficher sa
        // fraîcheur. Jamais mis à jour depuis une ligne live (marché suspendu).
        if (!m.isLive && m.sets) { e.sets = m.sets; e.setsAt = run.fetchedAt; }
        if (!m.isLive && m.totals) { e.totals = m.totals; e.totalsAt = run.fetchedAt; }

        if (m.odd1 == null || m.odd2 == null) continue;
        // Une cote LIVE n'entre jamais dans la série : à un relevé toutes les
        // 2 h on ne peut pas suivre un match en cours, et la « clôture » doit
        // rester la dernière cote d'AVANT match — c'est elle qu'on comparera
        // au modèle. (Les relevés récents ne contiennent plus de live, mais
        // les premiers en avaient : on filtre aussi à la lecture.)
        if (m.isLive) continue;
        const dernier = e.points[e.points.length - 1];
        if (dernier && dernier.odd1 === m.odd1 && dernier.odd2 === m.odd2) {
          dernier.lastSeen = run.fetchedAt; // même cote : on prolonge
          continue;
        }
        e.points.push({
          at: run.fetchedAt, lastSeen: run.fetchedAt,
          odd1: m.odd1, odd2: m.odd2,
          impliedP1: impliedP1(m.odd1, m.odd2),
        });
      }
    }
  }

  const out = [];
  for (const e of parCle.values()) {
    const pts = e.points;
    const ouverture = pts[0] ?? null;
    const cloture = pts[pts.length - 1] ?? null;
    out.push({
      ...e,
      readings: pts.length,
      opening: ouverture,
      closing: cloture,
      moved: pts.length > 1,
      driftP1: ouverture && cloture && ouverture.impliedP1 != null && cloture.impliedP1 != null
        ? cloture.impliedP1 - ouverture.impliedP1
        : null,
      overround: cloture ? overround(cloture.odd1, cloture.odd2) : null,
    });
  }
  return out.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
}

// Tokens « porteurs » d'un nom affiché (initiales d'1 lettre écartées).
// Sert à orienter les camps entre opérateurs : "TB.Yoo" et "Tae Bin Yoo"
// partagent le token "yoo".
const tokensOf = (name) =>
  new Set(normalizeLabel(String(name || "").replaceAll("/", " ")).split(" ").filter((t) => t.length >= 2));

const overlap = (a, b) => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

// Qualité des noms par opérateur : Winamax publie les noms complets, Betclic
// des noms quasi complets, Unibet des abréviations. Le mieux nommé fait
// référence pour le groupe (noms affichés ET orientation des camps).
const PREFERENCE = ["winamax", "betclic", "unibet"];

/**
 * Regroupe les séries d'un même match entre opérateurs (jointure par srId ;
 * sans srId, la ligne reste seule sous une clé de repli book:bookMatchId).
 *
 * Chaque opérateur du groupe expose `odd1`/`odd2` RÉORIENTÉES vers l'ordre de
 * référence du groupe, et `swapped` dit si son affichage était inversé. En cas
 * de doute (aucun token de nom partagé), on suppose l'ordre Sportradar commun
 * — hypothèse documentée, `swapped: false`.
 *
 * @param {Array<object>} series sorties de buildBookSeries
 * @returns {Array<object>} un groupe par match
 */
export function groupBooks(series) {
  const groupes = new Map();
  for (const s of series) {
    const cle = s.srId || `${s.book}:${s.bookMatchId}`;
    const list = groupes.get(cle) || [];
    list.push(s);
    groupes.set(cle, list);
  }

  const out = [];
  for (const [cle, list] of groupes) {
    const ref = [...list].sort(
      (a, b) => PREFERENCE.indexOf(a.book) - PREFERENCE.indexOf(b.book),
    )[0];
    const ref1 = tokensOf(ref.p1), ref2 = tokensOf(ref.p2);

    const books = {};
    for (const s of list) {
      const direct = overlap(tokensOf(s.p1), ref1) + overlap(tokensOf(s.p2), ref2);
      const croise = overlap(tokensOf(s.p1), ref2) + overlap(tokensOf(s.p2), ref1);
      const swapped = croise > direct;
      // La réorientation retourne les cotes ET la probabilité implicite —
      // un graphe qui oublierait impliedP1 tracerait le mauvais camp.
      const orient = (p) =>
        p == null ? null : swapped
          ? { ...p, odd1: p.odd2, odd2: p.odd1, impliedP1: p.impliedP1 == null ? null : 1 - p.impliedP1 }
          : p;
      books[s.book] = {
        bookMatchId: s.bookMatchId,
        swapped,
        odd1: orient(s.closing)?.odd1 ?? null,
        odd2: orient(s.closing)?.odd2 ?? null,
        opening: s.opening,   // dans l'ordre d'affichage de l'opérateur
        closing: s.closing,   // idem — `swapped` permet de réorienter
        points: s.points.map(orient), // réorientés vers l'ordre du groupe
        readings: s.readings,
        moved: s.moved,
        driftP1: s.driftP1 == null ? null : (swapped ? -s.driftP1 : s.driftP1),
        overround: s.overround,
        isLive: s.isLive,
        p1: s.p1, p2: s.p2,          // noms tels qu'affichés chez l'opérateur
        tournament: s.tournament,    // libellé de tournoi de l'opérateur (vue brute)
      };
    }

    out.push({
      key: cle,
      srId: ref.srId ?? null,
      tournament: ref.tournament,
      discipline: ref.discipline,
      p1: ref.p1,
      p2: ref.p2,
      startUtc: ref.startUtc,
      isLive: list.some((s) => s.isLive),
      books,
    });
  }
  return out.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
}
