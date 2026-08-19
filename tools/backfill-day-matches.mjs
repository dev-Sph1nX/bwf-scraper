// tools/backfill-day-matches.mjs
// Backfill des matchs d'un tournoi ANCIEN dont l'API vue-tournament-draw-data
// ne sert plus le tableau ("No draw data - possible exception") : constaté sur
// ~20 tournois 2022 et ~12 tournois 2023 (les années 2024+ sont servies).
//
//   node tools/backfill-day-matches.mjs 2022            # tous les tournois à 0 match
//   node tools/backfill-day-matches.mjs 2022 4475       # un tournoi précis
//
// Source : GET /api/tournaments/day-matches?tournamentCode=<GUID>&date=<jour>
// (l'endpoint que le site officiel utilise pour ses pages « results » — les
// objets match sont EXACTEMENT au même schéma que ceux de vue-tournament-draw-data).
// On parcourt chaque jour du tournoi (±1 jour de marge pour les qualifications),
// on unionne par id de match, on regroupe par drawCode et on écrit chaque
// draw-<code>.json via lib/store (manifest tenu à jour).
//
// LIMITE ASSUMÉE : la grille du bracket (`results`) n'est pas reconstituable
// depuis cette source (le site officiel lui-même n'affiche pour ces tournois
// qu'un lien « Full Draw » vers un widget externe). On écrit results:{} —
// la liste des matchs (Elo, backtest, jointure des cotes) est complète, seule
// la vue bracket de la fiche tournoi reste vide pour ces éditions.
//
// Relançable sans perte : un tournoi dont les draws ont déjà des matchs est sauté.

import { BwfClient } from "../lib/client.mjs";
import * as store from "../lib/store.mjs";
import { flattenTournaments } from "../lib/api.mjs";

const BASE = "https://extranet-lv.bwfbadminton.com/api";
const YEAR = Number(process.argv[2]);
const ONLY = process.argv.slice(3).map(Number).filter(Boolean);
if (!YEAR) {
  console.error("usage : node tools/backfill-day-matches.mjs <année> [tmtId…]");
  process.exit(1);
}

const day = (s) => String(s).slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const yearData = await store.getYear(YEAR);
if (!yearData) {
  console.error(`data/${YEAR}/tournaments.json absent : lancer d'abord run-update.mjs ${YEAR}`);
  process.exit(1);
}
const tournaments = flattenTournaments(yearData);

const client = await new BwfClient().start();
try {
  for (const t of tournaments) {
    if (ONLY.length && !ONLY.includes(t.id)) continue;
    if (/olympic/i.test(t.name)) continue;
    if (/cancelled/i.test(t.name)) { console.log(`— ${t.name} : annulé, ignoré`); continue; }

    const draws = await store.getDraws(YEAR, t.id);
    const drawList = draws?.results ?? [];
    if (!drawList.length) { console.log(`— ${t.name} : aucun draw listé, ignoré`); continue; }

    // Déjà servi par vue-tournament-draw-data ? On ne touche à rien.
    let existing = 0;
    for (const d of drawList) {
      const data = await store.getDraw(YEAR, t.id, d.value);
      existing += (data?.matches ?? []).length;
    }
    if (existing > 0) { console.log(`— ${t.name} : ${existing} matchs déjà présents, sauté`); continue; }

    if (!t.code) { console.log(`⚠ ${t.name} : pas de tournamentCode (GUID), impossible`); continue; }

    // Union des matchs jour par jour (marge ±1 jour pour les qualifications).
    const from = addDays(day(t.start_date), -1);
    const to = addDays(day(t.end_date ?? t.start_date), 1);
    const byId = new Map();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const url = `${BASE}/tournaments/day-matches?tournamentCode=${t.code}&date=${d}&order=2&court=0`;
      let rows;
      try {
        const json = await client.getJson(url);
        rows = Array.isArray(json) ? json : (json?.results ?? json?.data ?? []);
      } catch (e) {
        console.log(`⚠ ${t.name} ${d} : ${e.message}`);
        continue;
      }
      for (const m of rows) if (m?.id != null) byId.set(m.id, m);
    }

    if (!byId.size) { console.log(`⚠ ${t.name} : 0 match via day-matches (tournoi non joué ?)`); continue; }

    // Regroupe par drawCode et écrit chaque draw au format du store.
    const byDraw = new Map();
    for (const m of byId.values()) {
      const code = String(m.drawCode ?? "");
      if (!byDraw.has(code)) byDraw.set(code, []);
      byDraw.get(code).push(m);
    }
    let total = 0;
    for (const [code, matches] of byDraw) {
      matches.sort((a, b) => String(a.matchTime || "").localeCompare(String(b.matchTime || "")));
      const meta = drawList.find((d) => String(d.value) === code);
      await store.saveDraw(YEAR, t.id, code, {
        results: {}, // grille non reconstituable, cf. en-tête
        matches,
        drawsize: meta?.size ?? null,
        drawendcol: null,
        gameTypeId: null,
        source: "day-matches", // trace la provenance du backfill
      }, "post");
      total += matches.length;
      console.log(`   ✓ ${t.name} — ${meta?.text ?? code} : ${matches.length} matchs`);
    }
    console.log(`📍 ${t.name} : ${total} matchs (${byDraw.size} draws) via day-matches`);
  }
} finally {
  await client.close();
}
