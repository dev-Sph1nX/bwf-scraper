// lib/publications.mjs
// Index des publications hebdomadaires du classement mondial BWF.
//
// L'endpoint vue-rankingweek renvoie en UNE requête la liste des publications
// avec leur id, leur date, leur semaine et leur année :
//
//   GET /api/vue-rankingweek?rankId=2
//   [ { "id": 4402, "year": 2026, "week": 31, "date": "2026-07-28 00:00:00",
//       "key": "2026-31-4402", "display": "Week 31 (2026-07-28)" }, … ]
//
// RÈGLE ABSOLUE : aucune date n'est calculée ici, seulement lue. Une conception
// antérieure déduisait les dates d'une ancre par arithmétique hebdomadaire ; la
// mesure a montré que les écarts d'id réels vont de 4 à 50, ce qui aurait fait
// échouer toute déduction fondée sur un pas régulier.
//
// L'API n'expose que 60 semaines GLISSANTES : une publication qui en sort n'est
// plus récupérable. L'index local doit donc être fusionné avec la réponse de
// l'API, jamais remplacé par elle (cf. mergeIndex, tâche 2).

const BASE = "https://extranet-lv.bwfbadminton.com/api";

/** Endpoint de l'index des publications du classement mondial (rankId=2). */
export const INDEX_URL = `${BASE}/vue-rankingweek?rankId=2`;

/**
 * Couples (id, date) relevés à la main sur le site BWF, indépendamment de l'API.
 * Servent de contrôle croisé : si l'API renvoyait un jour d'autres dates pour ces
 * ids, c'est que quelque chose a changé et il faut s'arrêter.
 */
export const ANCHORS = [
  { publicationId: 3821, date: "2025-06-10" },
  { publicationId: 3828, date: "2025-06-17" },
  { publicationId: 3835, date: "2025-06-24" },
  { publicationId: 3842, date: "2025-07-01" },
  { publicationId: 4387, date: "2026-07-14" },
  { publicationId: 4394, date: "2026-07-21" },
  { publicationId: 4402, date: "2026-07-28" },
];

const DAY_MS = 86_400_000;
const isTuesday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 2;

/** Normalise la réponse de l'API : date tronquée au jour, tri par date croissante. */
export function normalizeIndex(rows) {
  return (rows || [])
    .map((r) => ({
      publicationId: Number(r.id),
      date: String(r.date ?? "").slice(0, 10) || null,
      week: Number(r.week),
      year: Number(r.year),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Valide un index. Lève en listant TOUS les désaccords : écrire de mauvaises
 * dates rendrait l'historique silencieusement mensonger.
 */
export function validateIndex(publications) {
  const errors = [];

  if (!Array.isArray(publications) || publications.length === 0) {
    throw new Error("Index de publications invalide :\n  - la liste est vide");
  }

  for (const p of publications) {
    if (!Number.isFinite(p.publicationId) || !p.date || !Number.isFinite(p.week)) {
      errors.push(`champ manquant ou invalide : ${JSON.stringify(p)}`);
    }
  }

  for (const p of publications) {
    if (p.date && !isTuesday(p.date)) {
      errors.push(`la date ${p.date} (id ${p.publicationId}) n'est pas un mardi`);
    }
  }

  const dates = publications.map((p) => p.date);
  const uniques = new Set(dates);
  if (uniques.size !== dates.length) {
    errors.push(`${dates.length - uniques.size} date(s) en doublon`);
  }

  // Suite hebdomadaire sans trou : (dernière − première) / 7 + 1 == effectif
  const premiere = dates[0];
  const derniere = dates[dates.length - 1];
  if (premiere && derniere) {
    const jours = (new Date(`${derniere}T00:00:00Z`) - new Date(`${premiere}T00:00:00Z`)) / DAY_MS;
    const attendu = jours / 7 + 1;
    if (!Number.isInteger(attendu) || attendu !== publications.length) {
      errors.push(
        `trou dans la suite hebdomadaire : ${publications.length} publications de ` +
        `${premiere} à ${derniere}, ${attendu} attendue(s)`,
      );
    }
  }

  // Ancres : une ancre ABSENTE est normale (fenêtre glissante) ; une ancre
  // présente avec une AUTRE date est une erreur.
  const parId = new Map(publications.map((p) => [p.publicationId, p.date]));
  for (const a of ANCHORS) {
    const trouve = parId.get(a.publicationId);
    if (trouve !== undefined && trouve !== a.date) {
      errors.push(`ancre ${a.publicationId} : l'API donne ${trouve}, attendu ${a.date}`);
    }
  }

  if (errors.length) {
    throw new Error(`Index de publications invalide :\n  - ${errors.join("\n  - ")}`);
  }
  return publications;
}

/** Récupère et valide l'index. Une seule requête. */
export async function fetchPublicationIndex(client) {
  const json = await client.getJson(INDEX_URL);
  const rows = Array.isArray(json) ? json : (json?.results ?? json?.data ?? []);
  const publications = validateIndex(normalizeIndex(rows));
  return {
    source: "vue-rankingweek",
    fetchedAt: new Date().toISOString(),
    publications,
  };
}
