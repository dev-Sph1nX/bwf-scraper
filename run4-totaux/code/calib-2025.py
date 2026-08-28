"""H4, H5, H6 + choix des seuils. Periode regardee : 2025 UNIQUEMENT.

2026 n'est lu nulle part ici (assertion explicite plus bas), sauf le simple
COMPTE de lignes/matchs 2026 deja publie en partie A, qui sert a projeter le
volume attendu.
"""
import os, sys, math, json, random, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, ANNEES_REGLAGE, Survie, dot, sigm, logistique
from moteur import features, DISCIPLINES
import strategie as st

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
toutes, _, _ = load_totaux()
for r in toutes:
    r["disc"] = r["disc"]
med = st.medianes_disciplines(toutes)
st.annote_cellules(toutes, med)

rows25 = [r for r in toutes if r["annee"] == "2025" and r["match_id"] in par_id]
assert not any(r["annee"] == "2026" for r in rows25)

OUT = []
W = OUT.append
W("# Calibration de la strategie sur 2025")
W("")

# ============================================================== H4 : Platt OOF
W("## H4 — calibration de Platt hors echantillon, estimee sur 2022-2024")
W("")
reglage = [m for m in ms if m["saison"] in ANNEES_REGLAGE]
reglage.sort(key=lambda m: (m["date"], m["match_id"]))

# lignes candidates : percentiles du total de points de la discipline, cotes
# jamais consultees.
def grille_lignes(sous_ensemble):
    g = {}
    for d in DISCIPLINES:
        v = sorted(m["_pts"] for m in sous_ensemble if m["discipline"] == d)
        if not v:
            continue
        g[d] = [math.floor(pct(v, q)) + 0.5 for q in (20, 35, 50, 65, 80)]
    return g

NPLIS = 5
n = len(reglage)
paires = []   # (p_modele_hors_echantillon, y)
from modele import ModelePoints
for k in range(NPLIS):
    test = reglage[k * n // NPLIS:(k + 1) * n // NPLIS]
    train = reglage[:k * n // NPLIS] + reglage[(k + 1) * n // NPLIS:]
    sous = ModelePoints(train)
    gril = grille_lignes(train)
    for m in test:
        for L in gril.get(m["discipline"], []):
            paires.append((sous.p_over(m, L), 1.0 if m["_pts"] > L else 0.0))

def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))

Xp = [[1.0, lg(p)] for p, _ in paires]
Yp = [y for _, y in paires]
a, b = logistique(Xp, Yp, ridge=1e-6)
W("Plis chronologiques : %d. Couples (match, ligne candidate) hors echantillon : %d." % (NPLIS, len(paires)))
W("")
W("Platt `logit' = a + b x logit` : **a = %.4f, b = %.4f**." % (a, b))
W("")

def p_cal(p):
    return sigm(a + b * lg(p))

for r in rows25:
    m = par_id[r["match_id"]]
    r["p_brut"] = mod.p_over(m, r["total"])
    r["p_mod"] = p_cal(r["p_brut"])
    r["p_mkt"] = devig(r["co_o"], r["cu_o"])
    r["p_mkt_c"] = devig(r["co_c"], r["cu_c"])
    r["ecart"] = r["p_mod"] - r["p_mkt"]
    r["ecart_brut"] = r["p_brut"] - r["p_mkt"]

def logloss(ps, ys):
    s = 0.0
    for p, y in zip(ps, ys):
        p = min(max(p, 1e-9), 1 - 1e-9)
        s -= y * math.log(p) + (1 - y) * math.log(1 - p)
    return s / len(ps)

ys = [float(r["res"]) for r in rows25]
W("| predicteur (lignes misables 2025) | log-loss |")
W("|---|---|")
W("| constante 50 %% | %.4f |" % logloss([0.5] * len(rows25), ys))
W("| marche ouverture | %.4f |" % logloss([r["p_mkt"] for r in rows25], ys))
W("| modele brut | %.4f |" % logloss([r["p_brut"] for r in rows25], ys))
W("| **modele calibre Platt (2022-2024)** | **%.4f** |" % logloss([r["p_mod"] for r in rows25], ys))
W("")
W("| decile de P modele calibre | lignes | P moy | over realise | ecart |")
W("|---|---|---|---|---|")
srt = sorted(rows25, key=lambda r: r["p_mod"])
N = len(srt)
for k in range(10):
    part = srt[k * N // 10:(k + 1) * N // 10]
    pm, ob = mean(r["p_mod"] for r in part), mean(r["res"] for r in part)
    W("| %d | %d | %.2f %% | %.2f %% | %+.2f pts |" % (k + 1, len(part), pm * 100, ob * 100, (ob - pm) * 100))
W("")
rho = None
W("Le classement est-il inchange ? corrélation de rang brut/calibre = %s." %
  ("1,000 (Platt est monotone croissante, b > 0)" if b > 0 else "NEGATIF, b < 0"))
W("")

# ================================================== H5 : le prix dit-il quelque chose ?
W("## H5 — le prix de Betclic dit-il quelque chose de la position de la ligne ?")
W("")
sd = statistics.pstdev([r["p_mkt"] for r in rows25])
W("Ecart-type de `P_marche_ouverture(over)` sur 2025 : **%.2f points** "
  "(min %.1f %%, max %.1f %%)." % (sd * 100, min(r["p_mkt"] for r in rows25) * 100,
                                   max(r["p_mkt"] for r in rows25) * 100))
W("")
# ligne principale par match : celle dont les prix de cloture sont les plus proches
principale = {}
for r in toutes:
    k = (r["match_id"], r["book"])
    d = abs(r["co_c"] - r["cu_c"])
    if k not in principale or d < principale[k][0]:
        principale[k] = (d, r["total"])
xs, yss = [], []
for r in rows25:
    p = principale.get((r["match_id"], r["book"]))
    if p:
        r["delta_ligne"] = r["total"] - p[1]
        xs.append(r["delta_ligne"]); yss.append(r["p_mkt"])
def corr(x, y):
    mx, my = mean(x), mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x)); sy = math.sqrt(sum((a - my) ** 2 for a in y))
    return sum((a - mx) * (c - my) for a, c in zip(x, y)) / (sx * sy)
W("Correlation entre `P_marche(over)` et l'ecart de la ligne a la ligne "
  "principale du match : **%.3f** (%d lignes)." % (corr(xs, yss), len(xs)))
W("")
W("| ecart a la ligne principale | lignes | P marche moy | P modele calibre moy | over realise |")
W("|---|---|---|---|---|")
for d in sorted({round(r.get("delta_ligne", 0)) for r in rows25 if "delta_ligne" in r}):
    part = [r for r in rows25 if r.get("delta_ligne") is not None and round(r.get("delta_ligne", 99)) == d]
    if len(part) < 30:
        continue
    W("| %+d | %d | %.2f %% | %.2f %% | %.2f %% |" % (
        d, len(part), mean(r["p_mkt"] for r in part) * 100,
        mean(r["p_mod"] for r in part) * 100, mean(r["res"] for r in part) * 100))
W("")

# ============================================ H6 : grille de seuils + placebo
W("## H6 — grille de seuils, ROI net du placebo (2025)")
W("")
univ25 = rows25
plac25, taille25 = st.placebos(univ25)
W("Placebos 2025 (ROI over moyen de toutes les lignes misables de la cellule) :")
W("")
W("| seau | discipline | lignes | placebo ROI over |")
W("|---|---|---|---|")
for c in sorted(plac25, key=lambda c: (st.SEAUX.index(c[0]), c[1])):
    W("| %s | %s | %d | %+.2f %% |" % (c[0], c[1], taille25[c], plac25[c] * 100))
W("")
W("| seuil | paris over | matchs | taux de selection | ROI over | placebo attendu | ROI net | IC 95 % net | volume 2026 projete |")
W("|---|---|---|---|---|---|---|---|---|")
GRILLE = (0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.12, 0.15)
lignes_2026, matchs_2026 = 2168, 1256   # comptes publies en partie A
resume = {}
for s in GRILLE:
    ov, _ = st.selection(rows25, s)
    if not ov:
        continue
    taux = len(ov) / float(len(rows25))
    tauxm = nm(ov) / float(nm(rows25))
    lo, hi = st.ic_roi_net(ov, plac25)
    resume[s] = (len(ov), nm(ov), roi_over(ov), st.placebo_attendu(ov, plac25), lo, hi)
    W("| %.2f | %d | %d | %.1f %% | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] | ~%d paris / ~%d matchs |" % (
        s, len(ov), nm(ov), taux * 100, roi_over(ov) * 100,
        st.placebo_attendu(ov, plac25) * 100, st.roi_net(ov, plac25) * 100,
        lo * 100, hi * 100, round(taux * lignes_2026), round(tauxm * matchs_2026)))
W("")

# leg under
W("Jambe **under** (symetrique) sur 2025 :")
W("")
W("| seuil | paris under | matchs | ROI under |")
W("|---|---|---|---|")
for s in GRILLE:
    un = [r for r in rows25 if r["ecart"] <= -s]
    if un:
        W("| %.2f | %d | %d | %+.2f %% |" % (s, len(un), nm(un), roi_under(un) * 100))
W("")

path = os.path.join(ROOT, "run4-totaux", "out", "calib-2025.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
json.dump({"platt_a": a, "platt_b": b}, open(os.path.join(ROOT, "run4-totaux", "out", "platt.json"), "w"))
