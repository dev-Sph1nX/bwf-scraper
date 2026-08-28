"""H16 — tirage a blanc corrige (profil de barreaux strict), sur 2025 et 2026."""
import os, sys, math, json, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, sigm
import strategie as st

FINAL = json.load(open(os.path.join(ROOT, "run4-totaux", "modele-final.json")))
PA, PB, S = FINAL["calibration_platt"]["a"], FINAL["calibration_platt"]["b"], FINAL["strategie"]["s_over"]
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
        r["ecart"] = r["p_mod"] - devig(r["co_o"], r["cu_o"])

OUT = []
W = OUT.append
W("# H16 — tirage a blanc corrige, profil de barreaux strict")
W("")
W("| annee | tirage | paris | matchs | ROI over | placebo | ROI net | IC 95 % du net |")
W("|---|---|---|---|---|---|---|---|")
resume = {}
for annee in ("2025", "2026"):
    univ = [r for r in toutes if r["annee"] == annee and "ecart" in r]
    plac, _ = st.placebos(univ)
    sel, _ = st.selection(univ, S)
    lo, hi = st.ic_roi_net(sel, plac)
    W("| %s | **reel** | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
        annee, len(sel), nm(sel), roi_over(sel) * 100, st.placebo_attendu(sel, plac) * 100,
        st.roi_net(sel, plac) * 100, lo * 100, hi * 100))
    for nom, fn in (("a blanc ancien (H8/H12)", st.tirage_a_blanc),
                    ("a blanc **strict** (H16)", st.tirage_a_blanc_strict)):
        fx = fn(sel, univ, seed=42)
        flo, fhi = st.ic_roi_net(fx, plac)
        W("| %s | %s | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
            annee, nom, len(fx), nm(fx), roi_over(fx) * 100, st.placebo_attendu(fx, plac) * 100,
            st.roi_net(fx, plac) * 100, flo * 100, fhi * 100))
    nets = sorted(st.roi_net(st.tirage_a_blanc_strict(sel, univ, seed=1000 + g), plac)
                  for g in range(200))
    sup = sum(1 for x in nets if x >= st.roi_net(sel, plac))
    resume[annee] = (st.roi_net(sel, plac), mean(nets), statistics.pstdev(nets),
                     pct(nets, 2.5), pct(nets, 97.5), sup)
W("")
W("| annee | net de la selection | 200 tirages stricts : net moyen | ecart-type | percentiles 2,5/97,5 | tirages >= selection |")
W("|---|---|---|---|---|---|")
for annee in ("2025", "2026"):
    d = resume[annee]
    W("| %s | %+.2f %% | %+.2f %% | %.2f pts | [%+.2f %% ; %+.2f %%] | **%d / 200** (p = %.3f) |" % (
        annee, d[0] * 100, d[1] * 100, d[2] * 100, d[3] * 100, d[4] * 100, d[5], (d[5] + 1) / 201.0))
W("")
path = os.path.join(ROOT, "run4-totaux", "out", "h16.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
