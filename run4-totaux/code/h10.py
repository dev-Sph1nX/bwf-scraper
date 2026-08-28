"""H10 — d'ou vient l'exces de confiance ? Platt hors echantillon sur 2022-2024
sous quatre restrictions de perimetre. Aucun prix lu ; `cotes.csv` n'est
consulte que pour savoir QUELS matchs 2022-2024 sont couverts."""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, ModelePoints, logistique, ANNEES_REGLAGE
from moteur import DISCIPLINES

ms, _ = construit()
reglage = [m for m in ms if m["saison"] in ANNEES_REGLAGE]
reglage.sort(key=lambda m: (m["date"], m["match_id"]))

couverts = {r["match_id"] for r in read_csv("cotes.csv")
            if r["misable"].strip().lower() == "true"}


def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def platt(quantiles, filtre_couvert):
    n, NPLIS = len(reglage), 5
    paires = []
    for k in range(NPLIS):
        test = reglage[k * n // NPLIS:(k + 1) * n // NPLIS]
        train = reglage[:k * n // NPLIS] + reglage[(k + 1) * n // NPLIS:]
        sous = ModelePoints(train)
        gril = {}
        for d in DISCIPLINES:
            v = sorted(m["_pts"] for m in train if m["discipline"] == d)
            gril[d] = [math.floor(pct(v, q)) + 0.5 for q in quantiles]
        for m in test:
            if filtre_couvert and m["match_id"] not in couverts:
                continue
            for L in gril[m["discipline"]]:
                paires.append((sous.p_over(m, L), 1.0 if m["_pts"] > L else 0.0))
    X = [[1.0, lg(p)] for p, _ in paires]
    Y = [y for _, y in paires]
    a, b = logistique(X, Y, ridge=1e-6)
    return a, b, len(paires)


OUT = []
W = OUT.append
W("# H10 — origine de l'exces de confiance")
W("")
W("Matchs 2022-2024 couverts par un operateur misable : **%d / %d** (%.1f %%)." % (
    sum(1 for m in reglage if m["match_id"] in couverts), len(reglage),
    sum(1 for m in reglage if m["match_id"] in couverts) / float(len(reglage)) * 100))
W("")
W("| variante | lignes candidates | matchs | couples | a | **pente b** |")
W("|---|---|---|---|---|---|")
for nom, q, cov, lbl in (
        ("(a) reference H4", (20, 35, 50, 65, 80), False, "tous"),
        ("(b) ligne mediane seule", (50,), False, "tous"),
        ("(c) matchs cotes seulement", (20, 35, 50, 65, 80), True, "cotes"),
        ("(d) mediane + matchs cotes", (50,), True, "cotes")):
    a, b, n = platt(q, cov)
    W("| %s | %s | %s | %d | %+.4f | **%.4f** |" % (
        nom, "p" + "/p".join(str(x) for x in q), lbl, n, a, b))
W("")
path = os.path.join(ROOT, "run4-totaux", "out", "h10.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
