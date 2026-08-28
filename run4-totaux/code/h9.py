"""H9 — la ligne principale de Betclic porte-t-elle une information absente du
modele ? Regressions sur les matchs cotes 2025. 2026 exclu."""
import os, sys, math, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, moindres_carres, dot

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
toutes, _, _ = load_totaux()

# ligne principale par (match, book) : prix de cloture les plus proches
principale = {}
for r in toutes:
    if r["annee"] != "2025":
        continue
    k = (r["match_id"], r["book"])
    d = abs(r["co_c"] - r["cu_c"])
    if k not in principale or d < principale[k][0]:
        principale[k] = (d, r["total"])

ech = []
for (mid, book), (_, ligne) in principale.items():
    m = par_id.get(mid)
    if not m:
        continue
    p3, mu2, mu3 = mod.parts(m)
    ech.append({"y": float(m["_pts"]), "mu": (1 - p3) * mu2 + p3 * mu3, "L": ligne})
assert ech and len(ech) > 1000

OUT = []
W = OUT.append
W("# H9 — la ligne principale sait-elle des choses que le modele ignore ?")
W("")
W("Echantillon : **%d** matchs cotes 2025 (une ligne principale par match)." % len(ech))
W("")


def corr(x, y):
    mx, my = mean(x), mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((a - my) ** 2 for a in y))
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)


ysv = [e["y"] for e in ech]
muv = [e["mu"] for e in ech]
Lv = [e["L"] for e in ech]
W("| paire | correlation de Pearson |")
W("|---|---|")
W("| total attendu du modele mu / total realise | **%.3f** |" % corr(muv, ysv))
W("| ligne principale Betclic / total realise | **%.3f** |" % corr(Lv, ysv))
W("| mu / ligne principale | %.3f |" % corr(muv, Lv))
W("")


def ols(X, y):
    b = moindres_carres(X, y)
    res = [yi - dot(b, xi) for xi, yi in zip(X, y)]
    n, k = len(X), len(X[0])
    s2 = sum(r * r for r in res) / (n - k)
    # (X'X)^-1 par resolution colonne par colonne
    A = [[sum(xi[a] * xi[c] for xi in X) for c in range(k)] for a in range(k)]
    from modele import resous
    inv = []
    for c in range(k):
        e = [1.0 if j == c else 0.0 for j in range(k)]
        inv.append(resous([row[:] for row in A], e))
    se = [math.sqrt(s2 * inv[c][c]) for c in range(k)]
    sst = sum((yi - mean(y)) ** 2 for yi in y)
    r2 = 1 - sum(r * r for r in res) / sst
    return b, se, r2


W("Regressions du total realise (moindres carres) :")
W("")
W("| modele | coefficient | valeur | erreur-type | t | R2 |")
W("|---|---|---|---|---|---|")
for nom, cols, noms in (
        ("(a) mu seul", lambda e: [1.0, e["mu"]], ["const", "mu"]),
        ("(b) ligne seule", lambda e: [1.0, e["L"]], ["const", "ligne"]),
        ("(c) les deux", lambda e: [1.0, e["mu"], e["L"]], ["const", "mu", "ligne"])):
    X = [cols(e) for e in ech]
    b, se, r2 = ols(X, ysv)
    for j, cn in enumerate(noms):
        W("| %s | %s | %+.4f | %.4f | %+.2f | %s |" % (
            nom if j == 0 else "", cn, b[j], se[j], b[j] / se[j],
            ("%.4f" % r2) if j == 0 else ""))
W("")
path = os.path.join(ROOT, "run4-totaux", "out", "h9.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
