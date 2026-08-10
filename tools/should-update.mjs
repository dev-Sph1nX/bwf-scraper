// tools/should-update.mjs
// Garde du workflow .github/workflows/deploy.yml : décide si la mise à jour
// quotidienne (scrape + build + déploiement, ~15 min avec Playwright) doit
// tourner MAINTENANT, ou si le passage horaire du cron peut être ignoré.
//
//   node tools/should-update.mjs
//
// POURQUOI : le cron fixe de 22:00 UTC ratait l'objectif pendant les tournois.
// L'Elo de forme n'a de valeur pour le pari que s'il intègre les résultats du
// jour AVANT les matchs du lendemain ; or selon le fuseau du tournoi (Corée =
// UTC+9, Amériques = UTC−5…−8) le dernier match du jour se joue parfois bien
// avant — ou bien après — 22:00 UTC. Le cron est donc devenu HORAIRE, et ce
// script (exécuté par un job léger : checkout + node, zéro dépendance npm,
// pas de Playwright) répond à chaque passage : « le dernier match du jour
// est-il fini, et a-t-on déjà mis à jour depuis ? ».
//
// DÉCISION (écrite dans $GITHUB_OUTPUT sous la forme `run=true|false`) :
//   1. Tournoi en cours avec des matchs programmés aujourd'hui (jour UTC) :
//      seuil = dernière heure de DÉBUT programmée du jour (matchTimeUtc des
//      draws committés) + tampon de 1 h. Le tampon absorbe les glissements de
//      programme (les débuts affichés sont indicatifs : retards, matchs longs)
//      ET la durée du dernier match lui-même — matchTimeUtc est une heure de
//      début, pas de fin. On déclenche si maintenant ≥ seuil ET que le dernier
//      update (dernier finishedAt de data/run-log.json, committé à chaque run)
//      est antérieur au seuil : une seule mise à jour par jour de tournoi.
//   2. Même règle appliquée aussi au jour UTC PRÉCÉDENT : un tournoi des
//      Amériques dont la session du soir commence après 21:00 UTC a un seuil
//      qui déborde sur le lendemain UTC — sans ce rattrapage, ces soirées ne
//      seraient jamais couvertes (le lendemain, on ne regarderait plus que les
//      matchs du nouveau jour).
//   3. Pas de tournoi, pas de draw connu (1er jour d'un tournoi : les draws ne
//      sont committés qu'après le 1er scrape), pas de match aujourd'hui, ou
//      programme sans horaires (que des minuit pile, cf. plus bas) : retour au
//      comportement historique, un run par jour au premier passage horaire
//      ≥ 22:00 UTC (~minuit à Paris) pas encore couvert.
//
// SOURCES (toutes committées, donc disponibles après un simple checkout) :
//   - data/<année>/tournaments.json : calendrier avec start_date / end_date
//     ("2026-08-04 00:00:00", dates civiles sans heure) ;
//   - data/<année>/<tmtId>/draw-*.json : matchTimeUtc ("2026-08-04 00:50:00",
//     heure de début programmée, UTC) — le scrape de la veille au soir contient
//     déjà le programme du lendemain (vérifié sur le Korea Masters 2026) ;
//   - data/run-log.json : une entrée { finishedAt } par run de run-update.mjs,
//     committée par l'étape « Commit data » — c'est notre « dernier update ».
//     Les déploiements sur push comptent donc aussi (ils exécutent run-update).
//
// TESTS : FAKE_NOW et FAKE_LAST_UPDATE (ISO 8601) remplacent respectivement
// l'horloge et le dernier finishedAt, pour rejouer un jour de tournoi passé :
//   FAKE_NOW=2026-08-04T13:30:00Z FAKE_LAST_UPDATE=2026-08-03T23:11:00Z \
//     node tools/should-update.mjs
//
// ROBUSTESSE : le script ne doit JAMAIS faire échouer le workflow ni couper
// silencieusement les mises à jour. Toute erreur imprévue (JSON corrompu,
// fichier manquant…) est rattrapée et dégrade vers l'ancien cron : run=true
// uniquement pendant l'heure de 22 h UTC (une fois par jour), run=false sinon.

import { readFileSync, readdirSync, existsSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");

// Tampon ajouté à la dernière heure de DÉBUT du jour. 1 h (choix du
// propriétaire, 2026-08-10) : la plupart des matchs durent moins ; si le
// dernier match déborde ou que le programme glisse, ses résultats sont
// rattrapés au run suivant, comme avec l'ancien cron quotidien.
const BUFFER_MS = 1 * 60 * 60 * 1000;
// Heure du fallback quotidien (comportement historique du cron "0 22 * * *").
const FALLBACK_HOUR_UTC = 22;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// "2026-08-04 00:50:00" (convention BWF, UTC implicite) → Date.
function parseBwfUtc(s) {
  return new Date(s.replace(" ", "T") + "Z");
}

// Date → "YYYY-MM-DD" (jour UTC).
function dayStr(date) {
  return date.toISOString().slice(0, 10);
}

// Tournois du calendrier dont l'intervalle [start_date, end_date] (dates
// civiles, bornes incluses) couvre le jour donné. Le calendrier est rangé par
// année : autour du Nouvel An, "hier" peut vivre dans un autre fichier que
// "aujourd'hui", d'où la lecture par année du jour demandé.
function tournamentsInProgress(day) {
  const year = day.slice(0, 4);
  const path = join(DATA_DIR, year, "tournaments.json");
  if (!existsSync(path)) return [];
  const calendar = readJson(path);
  const out = [];
  for (const month of calendar.results ?? []) {
    for (const t of month.tournaments ?? []) {
      const start = String(t.start_date ?? "").slice(0, 10);
      const end = String(t.end_date ?? "").slice(0, 10);
      if (start && end && start <= day && day <= end) out.push(t);
    }
  }
  return out;
}

// Heures de début (matchTimeUtc) programmées le jour donné, tous draws du
// tournoi confondus. On ne filtre PAS sur le statut : les matchs déjà finis
// ("F") comptent autant que les matchs à venir ("N") pour situer la fin de la
// journée — au moment où la garde tourne, tous peuvent déjà être finis.
function matchStartsForDay(tournament, day) {
  const dir = join(DATA_DIR, day.slice(0, 4), String(tournament.id));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const starts = [];
  for (const file of readdirSync(dir)) {
    if (!/^draw-\d+\.json$/.test(file)) continue;
    const draw = readJson(join(dir, file));
    // `results` est un objet indexé "ligne-colonne" ("0-0", "0-1", …) dans
    // tous les fichiers du dépôt (vérifié sur 668 draws 2024-2026), mais on
    // tolère aussi un tableau par prudence.
    const entries = Array.isArray(draw.results)
      ? draw.results
      : Object.values(draw.results ?? {});
    for (const entry of entries) {
      const time = entry?.match?.matchTimeUtc;
      if (typeof time === "string" && time.startsWith(day)) starts.push(time);
    }
  }
  return starts;
}

// Seuil de déclenchement pour un jour UTC donné, ou null si ce jour ne fournit
// aucun horaire exploitable (pas de tournoi, draws pas encore committés,
// aucun match ce jour, ou programme non horodaté).
function tournamentThreshold(day) {
  const tournaments = tournamentsInProgress(day);
  if (tournaments.length === 0) return null;
  let starts = [];
  const names = [];
  for (const t of tournaments) {
    const s = matchStartsForDay(t, day);
    if (s.length > 0) names.push(t.name);
    starts = starts.concat(s);
  }
  if (starts.length === 0) return null;
  // Programme non horodaté : quand l'ordre de passage n'est pas encore fixé,
  // l'API met matchTimeUtc à minuit pile. Un minuit ISOLÉ peut être un vrai
  // début (00:00 UTC = 09:00 en Corée), et il ne fausse pas le max ; mais si
  // TOUTES les heures du jour sont à minuit, on ne sait rien du programme →
  // on laisse le fallback quotidien prendre la main plutôt que de déclencher
  // à 03:00 UTC sur un seuil fantaisiste.
  if (starts.every((s) => s.endsWith("00:00:00"))) return null;
  const lastStart = starts.reduce((a, b) => (a > b ? a : b));
  return {
    at: new Date(parseBwfUtc(lastStart).getTime() + BUFFER_MS),
    label: `tournoi (${names.join(" + ")}) : dernier début du ${day} à ${lastStart.slice(11, 16)} UTC + ${BUFFER_MS / 3600000} h`,
  };
}

// Dernier update = dernier finishedAt du journal des runs. Absent (dépôt tout
// neuf, fichier corrompu) → époque 0 : tout seuil atteint déclenchera.
function lastUpdateAt() {
  if (process.env.FAKE_LAST_UPDATE) return new Date(process.env.FAKE_LAST_UPDATE);
  const path = join(DATA_DIR, "run-log.json");
  if (!existsSync(path)) return new Date(0);
  const log = readJson(path);
  const last = Array.isArray(log) ? log[log.length - 1] : null;
  return last?.finishedAt ? new Date(last.finishedAt) : new Date(0);
}

function decide(now) {
  const lastUpdate = lastUpdateAt();
  const today = dayStr(now);
  const yesterday = dayStr(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  // Seuils candidats : jour de tournoi (aujourd'hui + débordement d'hier),
  // sinon fallback quotidien. La règle de déclenchement est la même pour
  // tous : maintenant ≥ seuil ET dernier update < seuil — c'est elle qui
  // garantit « au plus un run par seuil », quel que soit le nombre de
  // passages horaires du cron.
  const thresholds = [];
  const todayThreshold = tournamentThreshold(today);
  if (todayThreshold) thresholds.push(todayThreshold);
  const yesterdayThreshold = tournamentThreshold(yesterday);
  if (yesterdayThreshold) thresholds.push(yesterdayThreshold);
  if (!todayThreshold) {
    thresholds.push({
      at: new Date(`${today}T${String(FALLBACK_HOUR_UTC).padStart(2, "0")}:00:00Z`),
      label: `fallback quotidien : pas de programme de tournoi exploitable aujourd'hui → ${FALLBACK_HOUR_UTC}:00 UTC`,
    });
  }

  console.log(`[garde] maintenant       : ${now.toISOString()}${process.env.FAKE_NOW ? " (FAKE_NOW)" : ""}`);
  console.log(`[garde] dernier update   : ${lastUpdate.toISOString()}${process.env.FAKE_LAST_UPDATE ? " (FAKE_LAST_UPDATE)" : ""}`);

  let run = false;
  for (const t of thresholds) {
    const reached = now >= t.at;
    const alreadyDone = lastUpdate >= t.at;
    const fire = reached && !alreadyDone;
    console.log(
      `[garde] seuil ${t.at.toISOString()} — ${t.label}` +
        ` → ${fire ? "DÉCLENCHE" : reached ? "déjà couvert par le dernier update" : "pas encore atteint"}`,
    );
    if (fire) run = true;
  }
  return run;
}

let run;
try {
  const now = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`FAKE_NOW illisible : ${process.env.FAKE_NOW}`);
  run = decide(now);
} catch (err) {
  // Dégradation contrôlée : on retombe sur l'ancien cron (un run pendant
  // l'heure de 22 h UTC, le cron horaire ne passant qu'une fois par heure).
  // Fail-open à 22 h plutôt que fail-closed : une garde cassée qui couperait
  // toutes les mises à jour serait invisible pendant des jours, alors qu'un
  // run quotidien de trop est sans danger.
  console.error(`[garde] erreur imprévue, retour au comportement 22 h UTC : ${err?.stack ?? err}`);
  run = new Date().getUTCHours() === FALLBACK_HOUR_UTC;
}

console.log(`[garde] décision : run=${run}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}
