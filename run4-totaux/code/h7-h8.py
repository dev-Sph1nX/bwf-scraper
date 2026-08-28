"""H7 (derive de la cible) et H8 (tirage a blanc sur 2025).
2026 n'est lu nulle part : filtres explicites + assertions."""
import os, sys, math, statistics, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit
import strategie as st

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
OUT = []
W = OUT.append

# ------------------------------------------------------------------- H7
W("# H7 — derive du total de points (2022-2025, 2026 exclu)")
W("")
W("| saison | matchs | total de points moyen | ecart-type | part 3 manches | duree moyenne (min) |")
W("|---|---|---|---|---|---|")
for a in ("2022", "2023", "2024", "2025"):
    s = [m for m in ms if m["saison"] == a]
    t = [m["_pts"] for m in s]
    d = [m["_duree"] for m in s if m["_duree"]]
    W("| %s | %d | %.2f | %.2f | %.2f %% | %.1f |" % (
        a, len(s), mean(t), statistics.pstdev(t),
        sum(1 for m in s if m["_manches"] == 3) / float(len(s)) * 100, mean(d)))
ref = [m for m in ms if m["saison"] in ("2022", "2023", "2024")]
c25 = [m for m in ms if m["saison"] == "2025"]
W("| **2022-2024 (reglage)** | %d | **%.2f** | %.2f | **%.2f %%** | %.1f |" % (
    len(ref), mean(m["_pts"] for m in ref), statistics.pstdev([m["_pts"] for m in ref]),
    sum(1 for m in ref if m["_manches"] == 3) / float(len(ref)) * 100,
    mean(m["_duree"] for m in ref if m["_duree"])))
W("")
d_pts = mean(m["_pts"] for m in c25) - mean(m["_pts"] for m in ref)
d_p3 = (sum(1 for m in c25 if m["_manches"] == 3) / float(len(c25))
        - sum(1 for m in ref if m["_manches"] == 3) / float(len(ref))) * 100
W("Ecart 2025 - (2022-2024) : **%+.2f point** de total moyen, **%+.2f point** de "
  "part de matchs en 3 manches." % (d_pts, d_p3))
W("")
W("Par discipline :")
W("")
W("| discipline | total moyen 2022-2024 | total moyen 2025 | ecart | P3 2022-2024 | P3 2025 | ecart |")
W("|---|---|---|---|---|---|---|")
for dd in sorted({m["discipline"] for m in ms}):
    a = [m for m in ref if m["discipline"] == dd]
    b = [m for m in c25 if m["discipline"] == dd]
    pa = sum(1 for m in a if m["_manches"] == 3) / float(len(a)) * 100
    pb = sum(1 for m in b if m["_manches"] == 3) / float(len(b)) * 100
    W("| %s | %.2f | %.2f | %+.2f | %.2f %% | %.2f %% | %+.2f |" % (
        dd, mean(m["_pts"] for m in a), mean(m["_pts"] for m in b),
        mean(m["_pts"] for m in b) - mean(m["_pts"] for m in a), pa, pb, pb - pa))
W("")

# ------------------------------------------------------------------- H8
W("# H8 — tirage a blanc sur 2025")
W("")
toutes, _, _ = load_totaux()
med = st.medianes_disciplines(toutes)
st.annote_cellules(toutes, med)
rows25 = [r for r in toutes if r["annee"] == "2025" and r["match_id"] in par_id]
assert not any(r["annee"] == "2026" for r in rows25)
import json
pl = json.load(open(os.path.join(ROOT, "run4-totaux", "out", "platt.json")))
from modele import sigm


def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


for r in rows25:
    p = mod.p_over(par_id[r["match_id"]], r["total"])
    r["p_mod"] = sigm(pl["platt_a"] + pl["platt_b"] * lg(p))
    r["ecart"] = r["p_mod"] - devig(r["co_o"], r["cu_o"])

plac, _ = st.placebos(rows25)
sel, _ = st.selection(rows25, 0.08)
W("Selection reelle (s = 0,08) : %d paris, %d matchs, ROI over %+.2f %%, "
  "ROI net du placebo %+.2f %%." % (len(sel), nm(sel), roi_over(sel) * 100,
                                    st.roi_net(sel, plac) * 100))
W("")
faux = st.tirage_a_blanc(sel, rows25, seed=42)
lo, hi = st.ic_roi_net(faux, plac)
W("| tirage | paris | matchs | ROI over | placebo attendu | ROI net | IC 95 % |")
W("|---|---|---|---|---|---|---|")
W("| **reel** | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | %s |" % (
    len(sel), nm(sel), roi_over(sel) * 100, st.placebo_attendu(sel, plac) * 100,
    st.roi_net(sel, plac) * 100, "[%+.2f %% ; %+.2f %%]" % tuple(x * 100 for x in st.ic_roi_net(sel, plac))))
W("| a blanc (graine 42) | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
    len(faux), nm(faux), roi_over(faux) * 100, st.placebo_attendu(faux, plac) * 100,
    st.roi_net(faux, plac) * 100, lo * 100, hi * 100))
W("")
nets = []
for g in range(200):
    fx = st.tirage_a_blanc(sel, rows25, seed=1000 + g)
    nets.append(st.roi_net(fx, plac))
nets.sort()
W("Sur **200 tirages a blanc independants** (graines 1000-1199) : ROI net moyen "
  "**%+.2f %%**, ecart-type %.2f pts, plage [%.2f %% ; %.2f %%], "
  "percentiles 2,5/97,5 = [%+.2f %% ; %+.2f %%]." % (
      mean(nets) * 100, statistics.pstdev(nets) * 100, nets[0] * 100, nets[-1] * 100,
      pct(nets, 2.5) * 100, pct(nets, 97.5) * 100))
sup = sum(1 for x in nets if x >= st.roi_net(sel, plac))
W("")
W("Tirages a blanc atteignant ou depassant la selection reelle : **%d / 200** "
  "(p empirique = %.3f)." % (sup, (sup + 1) / 201.0))

path = os.path.join(ROOT, "run4-totaux", "out", "h7-h8.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
