// lib/flashscore-join.mjs
// Jointure des cotes historiques Flashscore (data/flashscore/odds/, produites
// par tools/flashscore/backfill-odds.mjs) vers NOS matchs BWF.
//
// Le problème : Flashscore abrège les noms (« Lu G. Z. », « Carnando L. R. »)
// et horodate en UTC là où le flux BWF donne l'heure locale de la salle. Un
// rapprochement par noms seuls serait fragile. La clé du rapprochement est
// donc l'EMPREINTE DE SCORE : la suite exacte des points de chaque manche
// (21-19, 11-21, 12-21) est quasi unique dans une discipline à ±1 jour près.
// Elle donne en prime l'ORIENTATION (si l'empreinte ne colle qu'inversée,
// le « home » Flashscore est notre team2). Les noms ne servent qu'à CONFIRMER
// (au moins un nom de famille partagé de chaque côté) et le jour à ±1 borne
// le fuseau. Au moindre doute — zéro ou plusieurs candidats — pas de jointure,
// et le compte est publié (rien n'est perdu silencieusement).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Charge tous les fichiers de cotes Flashscore. Rend [] si le dossier manque. */
export async function loadFlashscoreOdds(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names.filter((x) => x.endsWith(".json") && !x.startsWith("_")).sort()) {
    const f = JSON.parse(await readFile(join(dir, n), "utf8"));
    if (Array.isArray(f?.matches) && f.matches.length) out.push(f);
  }
  return out;
}

// Jetons « porteurs » d'un nom : minuscules, sans accents, initiales écartées.
// "Carnando L. R./Marthin D." -> {carnando, marthin} ; "NG Ka Long Angus" ->
// {ng, ka, long, angus} — « ng » (2 lettres) doit rester, d'où le seuil à 2.
const tokensOf = (name) =>
  new Set(
    String(name || "")
      .normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 2),
  );

const shareToken = (a, b) => {
  for (const t of a) if (b.has(t)) return true;
  return false;
};

/** "21-19,11-21" — empreinte d'une liste de manches, orientable. */
const fingerprint = (sets, swap = false) =>
  (sets || []).map((s) => (swap ? `${s.away}-${s.home}` : `${s.home}-${s.away}`)).join(",");

/** Jour UTC (AAAA-MM-JJ) d'un ISO ; jour BRUT d'un "YYYY-MM-DD hh:mm" local. */
const dayOfIso = (iso) => String(iso || "").slice(0, 10);

/** Écart en jours entre deux "AAAA-MM-JJ" (valeur absolue). */
const dayGap = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

/**
 * Joint les matchs Flashscore aux matchs BWF.
 *
 * @param {Array} fsFiles   sorties de loadFlashscoreOdds
 * @param {Array} bwfRows   une ligne par match BWF joué :
 *   { tmtId, disc, day: "AAAA-MM-JJ", name1, name2, sets: [{home,away}], a, b }
 *   (name1/name2 = noms affichés des camps team1/team2, sets orientés team1)
 * @returns {{ joined: Map<string, object>, stats: object }}
 *   joined : clé `${tmtId}|${disc}|${day}|${a}|${b}` (même schéma que
 *   l'appariement des relevés bookmakers dans build-data) -> cotes orientées
 *   team1/team2 : { books: {op: {odd1, odd2, open1, open2}}, startUtc, via }.
 */
export function joinFlashscore(fsFiles, bwfRows) {
  // Index BWF par discipline + empreinte de score : le gros du tri est fait là.
  const byPrint = new Map();
  for (const r of bwfRows) {
    if (!r.sets?.length) continue;
    const k = `${r.disc}|${fingerprint(r.sets)}`;
    let arr = byPrint.get(k);
    if (!arr) byPrint.set(k, (arr = []));
    arr.push(r);
  }

  const joined = new Map();
  const stats = { fsMatches: 0, joined: 0, unmatched: 0, ambiguous: 0 };

  for (const file of fsFiles) {
    for (const m of file.matches) {
      if (!m.sets?.length || !m.odds) continue;
      stats.fsMatches++;
      const fsDay = dayOfIso(m.startUtc);
      const homeTok = tokensOf(m.home?.name), awayTok = tokensOf(m.away?.name);

      // Candidats : même discipline, empreinte directe OU inversée, ±1 jour,
      // et au moins un nom de famille partagé de chaque côté.
      const candidates = [];
      for (const swap of [false, true]) {
        for (const r of byPrint.get(`${m.disc}|${fingerprint(m.sets, swap)}`) || []) {
          if (!r.day || dayGap(fsDay, r.day) > 1) continue;
          const t1 = tokensOf(r.name1), t2 = tokensOf(r.name2);
          const okNames = swap
            ? shareToken(homeTok, t2) && shareToken(awayTok, t1)
            : shareToken(homeTok, t1) && shareToken(awayTok, t2);
          if (okNames) candidates.push({ r, swap });
        }
      }

      // Dédoublonne (le même match BWF peut ressortir des deux orientations si
      // toutes les manches sont symétriques, ex. 21-19, 19-21 — cas d'école).
      const uniq = [...new Map(candidates.map((c) => [`${c.r.tmtId}|${c.r.a}|${c.r.b}`, c])).values()];
      if (uniq.length !== 1) {
        stats[uniq.length ? "ambiguous" : "unmatched"]++;
        continue;
      }

      const { r, swap } = uniq[0];
      const books = {};
      for (const [op, sides] of Object.entries(m.odds)) {
        const t1 = swap ? sides.away : sides.home; // cotes de NOTRE team1
        const t2 = swap ? sides.home : sides.away;
        if (t1?.closing == null || t2?.closing == null) continue;
        books[op] = { odd1: t1.closing, odd2: t2.closing, open1: t1.opening ?? null, open2: t2.opening ?? null };
      }
      if (!Object.keys(books).length) { stats.unmatched++; continue; }
      joined.set(`${r.tmtId}|${r.disc}|${r.day}|${r.a}|${r.b}`, {
        books,
        startUtc: m.startUtc ?? null,
        via: "flashscore",
        // Identifiant Flashscore du match : sert de clé vers les autres
        // marchés du même match (data/flashscore/sets/), qui ne passent pas
        // par cette structure. Purement informatif ici.
        fsId: m.fsId ?? null,
      });
      stats.joined++;
    }
  }
  return { joined, stats };
}
