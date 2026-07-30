// lib/odds.mjs
// Scrape des cotes badminton sur oddsportal.com via un vrai navigateur.
//
// Même principe que BwfClient : on ouvre Chromium UNE fois et on réutilise le
// contexte pour toutes les dates. Ici on lit du DOM (pas du JSON d'API), d'où un
// client séparé.
//
// On ne s'appuie QUE sur les attributs `data-testid` : les classes du site sont
// des utilitaires Tailwind générés, donc volatiles.

import { chromium } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const BASE = "https://www.oddsportal.com/matches/badminton";

/** "2026-07-30" -> "20260730" (format d'URL oddsportal). */
export const toUrlDate = (iso) => iso.replaceAll("-", "");

/** Liste de N dates ISO à partir d'une date ISO incluse. */
export function dateRange(startIso, days) {
  const out = [];
  const d = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// --- Analyse des libellés -------------------------------------------------

// Discipline déduite du nom de ligue. Les doubles DOIVENT être testés avant les
// simples, sinon "Doubles Men" matcherait la règle "Men".
const DISCIPLINE_RULES = [
  [/\bmixed\s+doubles\b/i, "XD"],
  [/\bdoubles\s+men\b|\bmen'?s?\s+doubles\b/i, "MD"],
  [/\bdoubles\s+women\b|\bwomen'?s?\s+doubles\b/i, "WD"],
  [/\bwomen\b/i, "WS"],
  [/\bmen\b/i, "MS"],
];

export function disciplineFromLeague(league) {
  for (const [re, code] of DISCIPLINE_RULES) if (re.test(league || "")) return code;
  return null;
}

/**
 * Libellé de ligue oddsportal -> clé de tournoi comparable au nom BWF.
 * "BWF World Tour - Doubles Men Taipei Open" -> "taipei open"
 */
export function tournamentKeyFromLeague(league) {
  let s = (league || "").replace(/^.*?\bBWF\b[^-]*-\s*/i, ""); // retire "BWF World Tour - "
  s = s.replace(/\bmixed\s+doubles\b|\bdoubles\s+(men|women)\b|\b(men|women)'?s?\s+doubles\b/gi, "");
  s = s.replace(/^\s*(men|women)\b/i, "");
  return normalizeLabel(s);
}

/** Minuscules, sans diacritiques, sans ponctuation, espaces compactés. */
export function normalizeLabel(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Découpe un nom affiché oddsportal en nom de famille + initiales.
 *   "Shujiwo P. B." -> { surname: "shujiwo", initials: ["p","b"] }
 *   "Lin Chun-Yi"   -> { surname: "lin chun yi", initials: [] }  (nom complet)
 *   "Prannoy H. S." -> { surname: "prannoy", initials: ["h","s"] }
 */
export function parseDisplayName(display) {
  const raw = (display || "").trim();
  // Les initiales sont les tokens finaux réduits à 1-3 lettres. oddsportal en
  // produit plusieurs variantes : "P.", "J-H.", "J.-F.", et parfois sans point
  // final ("Lee F. C"). Plutôt que d'empiler les cas, on teste la substance :
  // une fois points et tirets retirés, il ne reste que 1 à 3 lettres — et on
  // exige un point OU une lettre unique, pour ne pas rogner un vrai nom court
  // ("Lin Chun-Yi" garde "Chun-Yi", "Yang Po-Hsuan" garde "Po-Hsuan").
  const isInitials = (t) => {
    const letters = t.replace(/[.\-]/g, "");
    if (!/^[A-Za-z]{1,3}$/.test(letters)) return false;
    return t.includes(".") || letters.length === 1;
  };
  const tokens = raw.split(/\s+/);
  const initials = [];
  while (tokens.length > 1 && isInitials(tokens[tokens.length - 1])) {
    const letters = tokens.pop().replace(/[.\-]/g, "").toLowerCase().split("");
    initials.unshift(...letters);
  }
  return { surname: normalizeLabel(tokens.join(" ")), initials, display: raw };
}

/** "Watanabe Y./Taguchi M." -> 2 joueurs. */
export function parseParticipant(display) {
  return (display || "").split("/").map((s) => parseDisplayName(s));
}

/**
 * Slug oddsportal depuis un segment d'URL H2H.
 * "lee-zii-jia-fkHsTftd" -> "lee-zii-jia" (on retire l'id de 8 caractères).
 */
export function stripSlugId(segment) {
  return (segment || "").replace(/-[A-Za-z0-9]{8}$/, "");
}

/**
 * Associe les 2 slugs de l'URL aux 2 participants affichés.
 *
 * Indispensable : l'ordre des slugs dans l'URL NE SUIT PAS l'ordre d'affichage
 * (constaté : href `hoh…/shujiwo…` pour un affichage `Shujiwo P. B.` / `Hoh J.`).
 * On choisit donc l'affectation qui maximise le recouvrement entre les tokens du
 * slug et les noms de famille du participant.
 */
export function alignSlugs(slugs, participants) {
  if (slugs.length !== 2 || participants.length !== 2) return [null, null];
  const overlap = (slug, players) => {
    const toks = new Set(normalizeLabel(slug.replaceAll("-", " ")).split(" "));
    let n = 0;
    for (const p of players) for (const t of p.surname.split(" ")) if (toks.has(t)) n++;
    return n;
  };
  const direct = overlap(slugs[0], participants[0]) + overlap(slugs[1], participants[1]);
  const swapped = overlap(slugs[1], participants[0]) + overlap(slugs[0], participants[1]);
  if (direct === 0 && swapped === 0) return [null, null]; // aucun signal : on n'invente pas
  if (direct === swapped) return [null, null]; // ambigu : mieux vaut rien que faux
  return direct > swapped ? [slugs[0], slugs[1]] : [slugs[1], slugs[0]];
}

// --- Client ---------------------------------------------------------------

export class OddsClient {
  #browser = null;
  #context = null;
  #page = null;

  async start({ headless = true } = {}) {
    this.#browser = await chromium.launch({ headless });
    this.#context = await this.#browser.newContext({
      userAgent: USER_AGENT,
      locale: "en-US",
      // Heures déterministes quelle que soit la machine (local ou CI).
      timezoneId: "UTC",
      viewport: { width: 1400, height: 1200 },
    });
    this.#page = await this.#context.newPage();
    return this;
  }

  /**
   * Récupère les lignes de match d'une date.
   * @param {string} dateIso "2026-07-30"
   * @returns {Promise<object[]>}
   */
  async fetchDate(dateIso) {
    if (!this.#page) throw new Error("OddsClient non démarré : appelez start() d'abord.");
    const url = `${BASE}/${toUrlDate(dateIso)}/`;
    await this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

    // Cloudflare peut servir un défi : on attend l'apparition des lignes.
    try {
      await this.#page.waitForSelector("div[data-testid='game-row']", { timeout: 45000 });
    } catch {
      // Pas de ligne : soit journée sans match, soit blocage. On distingue via le titre.
      const title = await this.#page.title();
      if (/just a moment|attention required/i.test(title)) {
        throw new Error(`Bloqué par Cloudflare sur ${url} (titre: "${title}")`);
      }
      return [];
    }

    // Lazy-load : on scrolle jusqu'à stabilisation du nombre de blocs.
    let prev = -1;
    for (let i = 0; i < 15; i++) {
      const n = await this.#page.locator(".eventRow").count();
      if (n === prev) break;
      prev = n;
      await this.#page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.#page.waitForTimeout(1200);
    }

    const raw = await this.#page.evaluate(() => {
      const out = [];
      const seen = new Set();
      // Un SEUL parcours en ordre du document. Deux raisons :
      //  - les entêtes (pays/tournoi) ne figurent que sur le premier bloc d'une
      //    série et doivent se propager aux blocs suivants ;
      //  - certains blocs `.eventRow` sont imbriqués ; itérer bloc par bloc
      //    collecterait deux fois les lignes du bloc enfant.
      let league = null, country = null;
      const nodes = document.querySelectorAll(".eventRow, div[data-testid='game-row'] > a[href]");
      for (const node of nodes) {
        if (node.classList.contains("eventRow")) {
          // `:scope >` : on ne lit que l'entête propre au bloc, pas celui d'un
          // bloc imbriqué qui pourrait relever d'un autre tournoi.
          const hdr = node.querySelector(":scope > [data-testid='sport-country-league-item']");
          const lg = hdr?.querySelector("a[data-testid='header-tournament-item']");
          const co = hdr?.querySelector("a[data-testid='header-country-item'] p");
          if (lg) league = lg.textContent.trim();
          if (co) country = co.textContent.trim();
          continue;
        }
        const a = node;
        if (seen.has(a)) continue;
        seen.add(a);
        const rowEl = a.closest("div[data-testid='game-row']");
        const parts = [...a.querySelectorAll("[data-testid='event-participants'] a[title]")].map((p) => ({
          display: p.getAttribute("title"),
          iso2: p.querySelector("img")?.getAttribute("alt") || null,
        }));
        // Les cotes sont dans les <p> des cellules. Pour un match déjà décidé, la
        // cote gagnante porte `odd-container-winning` au lieu de `-default` :
        // le préfixe couvre les deux cas.
        const oddEls = [...rowEl.querySelectorAll("p[data-testid^='odd-container']")];
        const href = a.getAttribute("href") || "";
        out.push({
          league,
          country,
          // L'ancre du lien identifie l'évènement de façon stable.
          eventId: href.includes("#") ? href.slice(href.indexOf("#") + 1) : a.closest(".eventRow")?.id || null,
          href,
          time: a.querySelector("[data-testid='time-item'] p")?.textContent.trim() || null,
          parts,
          odds: oddEls.map((p) => p.textContent.trim()),
          // Match dont le vainqueur est connu (cote surlignée) : à exclure des
          // matchs « à venir ».
          settled: oddEls.some((p) => p.getAttribute("data-testid") === "odd-container-winning"),
        });
      }
      return out;
    });

    return raw.map((r) => this.#shape(r, dateIso)).filter(Boolean);
  }

  /** Transforme une ligne brute du DOM en OddsRow exploitable. */
  #shape(r, dateIso) {
    if (r.parts.length !== 2) return null;
    const participants = r.parts.map((p) => parseParticipant(p.display));
    const slugSegments = (r.href || "")
      .split("/")
      .filter(Boolean)
      .filter((s) => s !== "badminton" && s !== "h2h" && !s.startsWith("#"))
      .map(stripSlugId);
    const [s1, s2] = alignSlugs(slugSegments, participants);
    const num = (s) => {
      const v = Number.parseFloat(s);
      return Number.isFinite(v) ? v : null;
    };
    const side = (i, slug) => ({
      display: r.parts[i].display,
      iso2: r.parts[i].iso2,
      slug,
      players: participants[i],
    });
    return {
      date: dateIso,
      time: r.time,
      eventId: r.eventId,
      href: r.href,
      country: r.country,
      league: r.league,
      discipline: disciplineFromLeague(r.league),
      tournamentKey: tournamentKeyFromLeague(r.league),
      settled: !!r.settled,
      p1: side(0, s1),
      p2: side(1, s2),
      odd1: r.odds.length >= 2 ? num(r.odds[0]) : null,
      odd2: r.odds.length >= 2 ? num(r.odds[1]) : null,
    };
  }

  async close() {
    if (this.#browser) await this.#browser.close();
    this.#browser = this.#context = this.#page = null;
  }
}
