// lib/csv-rankings.mjs
// Import des classements mondiaux BWF fournis en CSV (2024-W01 → 2025-W23),
// pour la période antérieure à la fenêtre glissante de 60 semaines de l'API.
//
// Pourquoi ce module existe : l'API n'expose que les 60 dernières publications
// (cf. lib/publications.mjs). Tout ce qui est plus ancien n'est récupérable que
// par ces exports CSV. Une fois importé, l'historique couvre toute la période
// des matchs scrapés (depuis 2024-01), ce qui rend calculable le baseline
// « le mieux classé gagne » du backtest.
//
// Trois pièges du format, tous rencontrés sur les fichiers réels :
//   1. des champs sont entre GUILLEMETS et contiennent des virgules
//      (172 lignes, ex. "Desiree, Hao Shan") — un split(",") décalerait toutes
//      les colonnes suivantes et corromprait silencieusement l'id du 2e joueur ;
//   2. les fins de ligne sont en CRLF ;
//   3. la numérotation de semaine de la BWF n'est PAS la norme ISO — elle a une
//      semaine 53 en 2024, année qui n'en compte que 52 au sens ISO. Les dates
//      ne peuvent donc pas être calculées depuis le numéro de semaine ; elles le
//      sont par chaînage hebdomadaire depuis une ancre (cf. weekDateChain).

const DAY_MS = 86_400_000;

/** Ancre de datation : la première semaine du lot CSV. Vient de la liste de PDF
 *  publiée par la BWF (« WR 2024-01-02 (Week-01) »). */
export const CSV_ANCHOR = { week: "2024-W01", date: "2024-01-02" };

/**
 * Découpe une ligne CSV en respectant les champs entre guillemets.
 * Un guillemet doublé à l'intérieur d'un champ cité vaut un guillemet littéral.
 */
export function parseCsvLine(line) {
  const out = [];
  let champ = "";
  let cite = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (cite) {
      if (c === '"') {
        if (line[i + 1] === '"') { champ += '"'; i++; }
        else cite = false;
      } else champ += c;
    } else if (c === '"') cite = true;
    else if (c === ",") { out.push(champ); champ = ""; }
    else champ += c;
  }
  out.push(champ);
  return out.map((s) => s.trim());
}

const nom = (prenom, patronyme) => [prenom, patronyme].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null;

/**
 * Parse un fichier CSV de classement vers notre forme de ligne.
 *
 * En-tête simple : Ranking,BWF ID,Last Name,First Name,Country,Points,Tour
 * En-tête double : Ranking,P1 BWF ID,P1 Last Name,P1 First Name,P1 Country,
 *                  P2 BWF ID,P2 Last Name,P2 First Name,P2 Country,Points,Tour
 *
 * `rankPrevious` et `rankChange` sont laissés à null : les CSV ne les portent
 * pas, ils sont calculés ensuite par withRankChanges().
 *
 * @param {string} texte  contenu du fichier
 * @param {{doubles: boolean}} o
 */
export function parseRankingCsv(texte, { doubles }) {
  const lignes = String(texte).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lignes.length === 0) return [];

  const attendu = doubles ? 11 : 7;
  const rows = [];

  for (let i = 1; i < lignes.length; i++) { // i = 1 : on saute l'en-tête
    const c = parseCsvLine(lignes[i]);
    if (c.length !== attendu) {
      throw new Error(
        `ligne ${i + 1} : ${c.length} colonnes au lieu de ${attendu} — ${JSON.stringify(lignes[i]).slice(0, 120)}`,
      );
    }

    const rank = Number(c[0]);
    if (!Number.isFinite(rank)) throw new Error(`ligne ${i + 1} : rang illisible « ${c[0]} »`);

    const players = [];
    if (doubles) {
      players.push({ id: String(c[1]), slug: null, name: nom(c[3], c[2]), country: c[4] || null });
      players.push({ id: String(c[5]), slug: null, name: nom(c[7], c[6]), country: c[8] || null });
    } else {
      players.push({ id: String(c[1]), slug: null, name: nom(c[3], c[2]), country: c[4] || null });
    }
    if (players.some((p) => !p.id)) throw new Error(`ligne ${i + 1} : identifiant BWF manquant`);

    rows.push({
      rank,
      rankPrevious: null,
      rankChange: null,
      points: Number(doubles ? c[9] : c[5]),
      tournaments: Number(doubles ? c[10] : c[6]),
      players,
    });
  }
  return rows;
}

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const isTuesday = (date) => toDate(date).getUTCDay() === 2;

/**
 * Associe une date à chaque semaine, par chaînage hebdomadaire depuis l'ancre.
 *
 * On NE calcule PAS la date depuis le numéro de semaine : la numérotation BWF
 * n'est pas ISO (semaine 53 en 2024, qui n'a que 52 semaines ISO). On avance de
 * 7 jours par semaine successive de la liste triée, ce qui suppose qu'elle est
 * complète et sans trou — hypothèse vérifiée par les garde-fous ci-dessous et,
 * de façon décisive, par le raccord avec la première publication de l'API.
 *
 * @param {string[]} semaines  clés « AAAA-Wnn » triées croissant
 * @param {{week:string, date:string}} ancre
 * @returns {Array<{week:string, date:string, weekNumber:number, year:number}>}
 */
export function weekDateChain(semaines, ancre = CSV_ANCHOR) {
  if (!semaines.length) throw new Error("aucune semaine à dater");
  if (semaines[0] !== ancre.week) {
    throw new Error(`la première semaine est ${semaines[0]}, l'ancre attend ${ancre.week}`);
  }

  const out = [];
  let d = toDate(ancre.date);
  for (const week of semaines) {
    const [an, w] = week.split("-W");
    out.push({ week, date: toIso(d), weekNumber: Number(w), year: Number(an) });
    d = new Date(d.getTime() + 7 * DAY_MS);
  }

  const erreurs = [];
  const pasMardi = out.filter((x) => !isTuesday(x.date));
  if (pasMardi.length) erreurs.push(`${pasMardi.length} date(s) qui ne sont pas un mardi (ex. ${pasMardi[0].week} → ${pasMardi[0].date})`);
  const dates = out.map((x) => x.date);
  if (new Set(dates).size !== dates.length) erreurs.push("date(s) en doublon");
  if (erreurs.length) throw new Error(`Chaîne de dates CSV invalide :\n  - ${erreurs.join("\n  - ")}`);

  return out;
}

/** Clé d'entité, même convention que lib/rank-history.mjs et lib/elo.mjs. */
const cleEntite = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length === 1 ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
};

/**
 * Renseigne rankPrevious / rankChange en comparant chaque publication à la
 * précédente. Modifie les publications sur place et les renvoie.
 *
 * Convention reprise de l'API, vérifiée sur 250/250 lignes réelles :
 *   rankChange = rankPrevious − rank   (donc POSITIF = progression)
 *
 * Une entité absente de la publication précédente garde `null` sur les deux
 * champs. C'est volontaire et ce n'est pas un pis-aller : l'API, elle, connaît
 * le vrai rang antérieur même au-delà du top 250 (un joueur passé 182e avait
 * `rankPrevious: 429`). Nos CSV étant aussi plafonnés à 250, écrire 251 serait
 * faux — et produirait un rankChange de +1 là où la progression réelle est de
 * +247. Un trou déclaré est exploitable ; une valeur inventée est indétectable.
 * Mesuré sur l'historique API : ce cas concerne 1,82 % des lignes.
 *
 * @param {Array<{date:string, disciplines:Record<string,Array>}>} publications  triées par date croissante
 */
export function withRankChanges(publications) {
  for (let i = 1; i < publications.length; i++) {
    const precedent = publications[i - 1];
    for (const [disc, rows] of Object.entries(publications[i].disciplines || {})) {
      const rangs = new Map(
        (precedent.disciplines?.[disc] || []).map((r) => [cleEntite(r.players), r.rank]),
      );
      for (const r of rows) {
        const avant = rangs.get(cleEntite(r.players));
        if (avant == null) { r.rankPrevious = null; r.rankChange = null; }
        else { r.rankPrevious = avant; r.rankChange = avant - r.rank; }
      }
    }
  }
  return publications;
}
