import { setsFor } from "../data.js";

const CARD_W = 260, COL_GAP = 74, GAP0 = 26, BASE_LEFT = 34;
const RN = { R128: "Round 128", R64: "Round 64", R32: "Round 32", R16: "Round 16",
             QF: "Quarter Final", SF: "Semi Final", F: "Final", Final: "Final", RR: "Round Robin" };
const leftOf = (c) => BASE_LEFT + c * (CARD_W + COL_GAP);

function Team({ match, side }) {
  const team = match[side === 1 ? "team1" : "team2"];
  const seed = match[side === 1 ? "team1seed" : "team2seed"];
  const isWin = match.winner === side;
  const players = team?.players ?? [];
  const flag = team?.countryFlagUrl || players[0]?.countryFlagUrl || "";
  return (
    <div className={`mteam ${isWin ? "win" : ""}`}>
      {flag
        ? <img className="mav" src={flag} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
        : <span className="mav" />}
      <div className="mnames">
        {players.map((p) => p.nameDisplay).join(" / ") || " "}
        {seed ? <span className="mseed">({seed})</span> : null}
      </div>
      <div className="mscore">
        {isWin ? <span className="mdot" /> : null}
        {setsFor(match, side).map((s, i) => (
          <span key={i} className={`mset ${s.won ? "won" : ""}`}>{s.value}</span>
        ))}
      </div>
    </div>
  );
}

export default function Bracket({ disc }) {
  const grid = disc.results || {};
  const cells = {};
  let maxCol = 0;
  for (const key of Object.keys(grid)) {
    const [c, r] = key.split("-").map(Number);
    (cells[c] ??= {})[r] = grid[key].match;
    if (c > maxCol) maxCol = c;
  }
  const cols = maxCol + 1;
  const n0 = Object.keys(cells[0] || {}).length;
  if (!n0) return <div className="card muted">Pas de données d'arbre pour cette discipline.</div>;

  const H = disc.doubles ? 84 : 60;

  // Centres verticaux
  const centers = [[]];
  for (let r = 0; r < n0; r++) centers[0][r] = r * (H + GAP0) + H / 2;
  for (let c = 1; c < cols; c++) {
    centers[c] = [];
    const nc = Math.max(1, Math.round(n0 / Math.pow(2, c)));
    for (let r = 0; r < nc; r++) centers[c][r] = (centers[c - 1][2 * r] + centers[c - 1][2 * r + 1]) / 2;
  }

  const width = BASE_LEFT + cols * (CARD_W + COL_GAP);
  const height = n0 * (H + GAP0);

  // Titres
  const titles = [];
  for (let c = 0; c < cols; c++) {
    const anyMatch = cells[c] && Object.values(cells[c])[0];
    const rn = anyMatch?.roundName;
    titles.push(
      <div key={c} className="rtitle" style={{ width: CARD_W, marginRight: COL_GAP }}>
        {RN[rn] || rn || `Tour ${c + 1}`}
      </div>
    );
  }

  // Connecteurs
  let paths = "";
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < centers[c].length; r++) {
      const childRight = leftOf(c - 1) + CARD_W;
      const parentLeft = leftOf(c);
      const midX = childRight + COL_GAP / 2;
      const y0 = centers[c - 1][2 * r], y1 = centers[c - 1][2 * r + 1], yp = centers[c][r];
      if (y0 == null || y1 == null) continue;
      paths += `M ${childRight} ${y0} H ${midX} M ${childRight} ${y1} H ${midX} M ${midX} ${y0} V ${y1} M ${midX} ${yp} H ${parentLeft} `;
    }
  }

  // Cartes + numéros de ligne
  const cards = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < centers[c].length; r++) {
      const top = centers[c][r] - H / 2;
      const match = cells[c]?.[r] ?? null;
      cards.push(
        <div key={`${c}-${r}`} className={`mcard ${match ? "" : "empty"}`}
             style={{ left: leftOf(c), top, width: CARD_W, height: H }}>
          {match && <><Team match={match} side={1} /><Team match={match} side={2} /></>}
        </div>
      );
      if (c === 0) {
        const yTop = centers[0][r] - H * 0.22, yBot = centers[0][r] + H * 0.22;
        cards.push(<div key={`n1-${r}`} className="rownum" style={{ left: 0, top: yTop - 9 }}>{2 * r + 1}</div>);
        cards.push(<div key={`n2-${r}`} className="rownum" style={{ left: 0, top: yBot - 9 }}>{2 * r + 2}</div>);
      }
    }
  }

  return (
    <div className="bracket-wrap">
      <div className="bracket-titles" style={{ width }}>
        <div style={{ width: BASE_LEFT }}></div>
        {titles}
      </div>
      <div className="bracket" style={{ width, height }}>
        <svg className="connectors" width={width} height={height}>
          <path d={paths} fill="none" stroke="#ffffff" strokeWidth="2" />
        </svg>
        {cards}
      </div>
    </div>
  );
}
