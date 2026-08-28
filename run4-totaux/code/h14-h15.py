"""H14 (le tirage a blanc est-il biaise par les lignes multiples ?) et
H15 (le modele discrimine-t-il encore sur 2026 ?). Diagnostics post-ouverture."""
import os, sys, math, json, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, sigm
import strategie as st

FINAL = json.load(open(os.path.join(ROOT, "run4-totaux", "modele-final.json")))
PA, PB = FINAL["calibration_platt"]["a"], FINAL["calibration_platt"]["b"]
ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
toutes, _, _ = load_totaux()
st.annote_cellules(toutes, FINAL["seaux"]["medianes"])


def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


for r in toutes:
    if r["match_id"] in par_id:
        r["p_mod"] = sigm(PA + PB * lg(mod.p_over(par_id[r["match_id"]], r["total"])))

OUT = []
W = OUT.append

# ------------------------------------------------------------------ H14
W("# H14 — le tirage a blanc est-il biaise par le nombre de lignes par match ?")
W("")
for annee in ("2025", "2026"):
    univ = [r for r in toutes if r["annee"] == annee and "p_mod" in r]
    par_m = {}
    for r in univ:
        par_m.setdefault(r["match_id"], []).append(r)
    for r in univ:
        r["nl"] = len(par_m[r["match_id"]])
    W("**%s** — univers %d lignes / %d matchs :" % (annee, len(univ), nm(univ)))
    W("")
    W("| barreaux du match | lignes | matchs | ROI over | IC 95 % |")
    W("|---|---|---|---|---|")
    for lbl, f in (("1", lambda r: r["nl"] == 1), ("2", lambda r: r["nl"] == 2),
                   ("3 ou plus", lambda r: r["nl"] >= 3)):
        part = [r for r in univ if f(r)]
        if not part:
            continue
        lo, hi = bootstrap_by_match(part, roi_over)
        W("| %s | %d | %d | %+.2f %% | [%+.2f %% ; %+.2f %%] |" % (
            lbl, len(part), nm(part), roi_over(part) * 100, lo * 100, hi * 100))
    un = [r for r in univ if r["nl"] == 1]
    tr = [r for r in univ if r["nl"] >= 3]
    W("")
    W("Ecart (3+ barreaux) − (1 barreau) : **%+.2f points**." % ((roi_over(tr) - roi_over(un)) * 100))
    W("")

# ------------------------------------------------------------------ H15
W("# H15 — le modele discrimine-t-il encore sur 2026 ?")
W("")
W("| annee | quintile de P modele | lignes | matchs | P modele moy | over realise | ROI over |")
W("|---|---|---|---|---|---|---|")
ecarts = {}
for annee in ("2025", "2026"):
    univ = sorted([r for r in toutes if r["annee"] == annee and "p_mod" in r],
                  key=lambda r: r["p_mod"])
    N = len(univ)
    parts = [univ[k * N // 5:(k + 1) * N // 5] for k in range(5)]
    for k, part in enumerate(parts):
        W("| %s | %d | %d | %d | %.2f %% | %.2f %% | %+.2f %% |" % (
            annee, k + 1, len(part), nm(part), mean(r["p_mod"] for r in part) * 100,
            mean(r["res"] for r in part) * 100, roi_over(part) * 100))
    haut, bas = parts[4], parts[0]
    diff = roi_over(haut) - roi_over(bas)

    def stat(rows):
        h = [r for r in rows if r["_q"] == "h"]
        b = [r for r in rows if r["_q"] == "b"]
        if not h or not b:
            return float("nan")
        return roi_over(h) - roi_over(b)

    for r in haut:
        r["_q"] = "h"
    for r in bas:
        r["_q"] = "b"
    lo, hi = bootstrap_by_match(haut + bas, stat)
    ecarts[annee] = (diff, lo, hi)
    W("| **%s** | **haut − bas** | | | | | **%+.2f %%**, IC [%+.2f %% ; %+.2f %%] |" % (
        annee, diff * 100, lo * 100, hi * 100))
W("")
for annee in ("2025", "2026"):
    d, lo, hi = ecarts[annee]
    W("- %s : ecart quintile haut − quintile bas = **%+.2f points**, "
      "IC 95 %% [%+.2f ; %+.2f] — %s zero." % (
          annee, d * 100, lo * 100, hi * 100, "contient" if lo <= 0 <= hi else "exclut"))
W("")

path = os.path.join(ROOT, "run4-totaux", "out", "h14-h15.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
