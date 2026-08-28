// lib/flashscore-points.mjs
// Décodeur du flux « point par point » Flashscore (`df_mh_1_<fsId>`).
//
// Isolé du collecteur (tools/flashscore/backfill-points.mjs) parce que c'est la
// seule partie testable hors ligne, et parce qu'importer le collecteur pour en
// tirer une fonction déclencherait une collecte de deux heures.
//
// FORMAT : texte brut, sections séparées par `~`, champs par `¬`, clé/valeur
// par `÷`. Une section `HA÷Set N` ouvre une manche, puis une section PAR POINT :
//   HC = score home        HE = score away
//   HG = SERVEUR (1 = home, 2 = away)
//   HK = MARQUEUR (1 = home, 2 = away)
//   HI / HJ = avance de home / de away, suffixe `-` quand le point vient d'être
//             marqué par celui qui est mené.
//
// Conventions VÉRIFIÉES par sonde sur 24 matchs étalés de 2022 à 2026
// (1 877 points) :
//   - HK == le camp dont le score augmente : 1877/1877 ;
//   - HI/HJ == l'écart HC-HE : 1877/1877 → STRICTEMENT REDONDANTS avec le
//     score, donc NON conservés (`serie` se recalcule par `score1 - score2`) ;
//   - HG(n) == HK(n-1) : 1820/1824 (au badminton le service revient au gagnant
//     du rallye). Les 4 exceptions sont des scories de saisie ; on rend HG TEL
//     QU'IL EST SERVI plutôt que de le recalculer, pour ne pas maquiller la
//     source. HG au PREMIER point d'une manche est la seule information non
//     déductible du score : qui a engagé.
//
// LE SCORE FAIT FOI, ET ON NE COMBLE RIEN. Le marqueur est lu sur la
// progression de HC/HE, pas sur HK. Quand cette progression n'est pas un +1
// propre d'un seul côté — le flux saute des points, constaté en production sur
// un 15-10 → 18-10 — le point est marqué « 0 » et l'écart est consigné dans
// `anomalies`. Deviner le camp manquant fabriquerait une séquence plausible et
// fausse, qu'aucun contrôle en aval ne pourrait plus détecter.

/**
 * Décode le flux point par point d'un match.
 *
 * @param {string} txt réponse brute du feed
 * @returns {null | {
 *   sets: Array<{ no: number, m: string, s: string, fin: [number, number] }>,
 *   anomalies: string[],
 * }}
 *   null = le flux ne porte pas de point par point (match sans données).
 *   `m` = marqueur de chaque point (1 = home, 2 = away, 0 = indéterminé),
 *   `s` = serveur de chaque point (0 = non servi par le flux),
 *   `fin` = score [home, away] à la fin de la manche.
 *   Orientation FLASHSCORE (home/away), PAS équipe 1 / équipe 2.
 */
export function decoder(txt) {
  if (!txt || !txt.includes("Point by point")) return null;
  const sets = [];
  let cur = null;
  for (const section of txt.split("~")) {
    const kv = {};
    for (const champ of section.split("¬")) {
      const i = champ.indexOf("÷");
      if (i > 0) kv[champ.slice(0, i)] = champ.slice(i + 1);
    }
    if (kv.HA !== undefined) {
      // Ouverture d'une manche. Le numéro vient du titre (« Set 3 ») quand il
      // s'y trouve, sinon du rang d'apparition.
      const no = Number(/(\d+)/.exec(kv.HA)?.[1]) || sets.length + 1;
      cur = { no, pts: [] };
      sets.push(cur);
      continue;
    }
    if (kv.HC === undefined || !cur) continue; // section hors points (métadonnées)
    cur.pts.push(kv);
  }
  if (!sets.some((s) => s.pts.length)) return null;

  const anomalies = [];
  const out = [];
  for (const s of sets) {
    if (!s.pts.length) { anomalies.push(`manche ${s.no} vide`); continue; }
    let h = 0, a = 0, m = "", srv = "";
    for (const [i, p] of s.pts.entries()) {
      const hc = Number(p.HC), he = Number(p.HE);
      const dh = hc - h, da = he - a;
      let marq;
      if (dh === 1 && da === 0) marq = "1";
      else if (dh === 0 && da === 1) marq = "2";
      else {
        marq = "0";
        anomalies.push(`manche ${s.no} point ${i + 1} : ${h}-${a} → ${hc}-${he}`);
      }
      if (p.HK && marq !== "0" && p.HK !== marq) {
        anomalies.push(`manche ${s.no} point ${i + 1} : HK=${p.HK} ≠ score (${hc}-${he})`);
      }
      m += marq;
      srv += p.HG === "1" || p.HG === "2" ? p.HG : "0";
      h = hc; a = he;
    }
    out.push({ no: s.no, m, s: srv, fin: [h, a] });
  }
  return out.length ? { sets: out, anomalies } : null;
}
