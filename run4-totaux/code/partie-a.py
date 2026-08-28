"""Partie A - replique diagnostique deterministe sur cotes-totaux.csv.
Sortie : run4-totaux/out/partie-a.md"""
import sys, os, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

OUT = []


def W(s=""):
    OUT.append(s)


rows, dropped, n_raw = load_totaux()

W("# Partie A - replique diagnostique")
W()
W("Source `export/cotes-totaux.csv` : **%d lignes** brutes." % n_raw)
W()
W("| filtre | lignes |")
W("|---|---|")
W("| ecartees `misable != true` | %d |" % dropped["non_misable"])
W("| ecartees cote manquante (une des 4) | %d |" % dropped["cote_manquante"])
W("| ecartees `resultat_over` manquant | %d |" % dropped["resultat_manquant"])
W("| **retenues** | **%d** |" % len(rows))
W()
W("Matchs distincts retenus : **%d**." % nm(rows))
W()

# ---------- 1. Couverture ----------
W("## A1 - Couverture : lignes et matchs distincts par (annee, operateur)")
W()
cells = {}
for r in rows:
    cells.setdefault((r["annee"], r["book"]), []).append(r)
W("| annee | operateur | lignes | matchs distincts | lignes/match |")
W("|---|---|---|---|---|")
for k in sorted(cells):
    rs = cells[k]
    W("| %s | %s | %d | %d | %.2f |" % (k[0], k[1], len(rs), nm(rs), len(rs) / nm(rs)))
for a in sorted({r["annee"] for r in rows}):
    rs = [r for r in rows if r["annee"] == a]
    W("| **%s** | *tous* | **%d** | **%d** | %.2f |" % (a, len(rs), nm(rs), len(rs) / nm(rs)))
W("| **total** | *tous* | **%d** | **%d** | %.2f |" % (len(rows), nm(rows), len(rows) / nm(rows)))
W()

# ---------- 2. Marge a l'ouverture ----------
W("## A2 - Marge a l'ouverture `moy(1/over_ouv + 1/under_ouv) - 1`")
W()
W("| perimetre | lignes | marge ouverture | marge cloture (info) |")
W("|---|---|---|---|")


def mrow(lbl, rs):
    W("| %s | %d | %.3f %% | %.3f %% |" % (
        lbl, len(rs),
        mean(marge(r["co_o"], r["cu_o"]) for r in rs) * 100,
        mean(marge(r["co_c"], r["cu_c"]) for r in rs) * 100))


mrow("**global**", rows)
for a in sorted({r["annee"] for r in rows}):
    mrow(a, [r for r in rows if r["annee"] == a])
W()

# ---------- 3. Calibration a l'ouverture ----------
W("## A3 - Calibration a l'ouverture : P(over) implicite de-viguee vs over realise")
W()
W("| perimetre | lignes | matchs | P(over) implicite | over realise | ecart |")
W("|---|---|---|---|---|---|")


def cal(lbl, rs):
    if not rs:
        return
    p = mean(devig(r["co_o"], r["cu_o"]) for r in rs)
    o = mean(r["res"] for r in rs)
    W("| %s | %d | %d | %.2f %% | %.2f %% | %+.2f pts |" % (lbl, len(rs), nm(rs), p * 100, o * 100, (o - p) * 100))


cal("**global**", rows)
for a in sorted({r["annee"] for r in rows}):
    cal("annee " + a, [r for r in rows if r["annee"] == a])
for d in sorted({r["disc"] for r in rows}):
    cal("discipline " + d, [r for r in rows if r["disc"] == d])
W()

# ---------- 4. ROI ouverture ----------
W("## A4 - ROI over et ROI under a l'ouverture (mise 1, prix brut)")
W()
lignes_triees = sorted(r["total"] for r in rows)
t1 = pct(lignes_triees, 100.0 / 3.0)
t2 = pct(lignes_triees, 200.0 / 3.0)
W("| perimetre | lignes | matchs | ROI over | ROI under | somme |")
W("|---|---|---|---|---|---|")


def rroi(lbl, rs):
    if not rs:
        return
    W("| %s | %d | %d | %+.2f %% | %+.2f %% | %+.2f %% |" % (
        lbl, len(rs), nm(rs), roi_over(rs) * 100, roi_under(rs) * 100,
        (roi_over(rs) + roi_under(rs)) * 100))


rroi("**global**", rows)
for a in sorted({r["annee"] for r in rows}):
    rroi("annee " + a, [r for r in rows if r["annee"] == a])
for d in sorted({r["disc"] for r in rows}):
    rroi("discipline " + d, [r for r in rows if r["disc"] == d])
rroi("tercile bas (ligne <= %.1f)" % t1, [r for r in rows if r["total"] <= t1])
rroi("tercile milieu (%.1f < ligne < %.1f)" % (t1, t2), [r for r in rows if t1 < r["total"] < t2])
rroi("tercile haut (ligne >= %.1f)" % t2, [r for r in rows if r["total"] >= t2])
W()
W("Bornes de tercile sur la distribution triee des %d lignes brutes, toutes annees : "
  "1/3 = **%.1f**, 2/3 = **%.1f** (min %.1f, mediane %.1f, max %.1f)." % (
      len(lignes_triees), t1, t2, lignes_triees[0],
      statistics.median(lignes_triees), lignes_triees[-1]))
W()

# ---------- 5. Ligne relative x annee ----------
W("## A5 - Ligne relative (`ligne - mediane de la discipline`) x annee")
W()
med_disc = {}
for d in sorted({r["disc"] for r in rows}):
    med_disc[d] = statistics.median([r["total"] for r in rows if r["disc"] == d])
W("| discipline | mediane des lignes misables (toutes annees) |")
W("|---|---|")
for d in sorted(med_disc):
    W("| %s | %.1f |" % (d, med_disc[d]))
W()
for r in rows:
    r["rel"] = r["total"] - med_disc[r["disc"]]


def seau(rel):
    if rel <= -2:
        return "rel <= -2"
    if rel >= 2:
        return "rel >= +2"
    return "-2 < rel < +2"


SEAUX = ["rel <= -2", "-2 < rel < +2", "rel >= +2"]
W("| seau | annee | lignes | matchs | P(over) realise | ROI over | IC 95 % (bootstrap match, 2000, graine 42) |")
W("|---|---|---|---|---|---|---|")
for s in SEAUX:
    for a in sorted({r["annee"] for r in rows}):
        rs = [r for r in rows if seau(r["rel"]) == s and r["annee"] == a]
        if not rs:
            continue
        lo, hi = bootstrap_by_match(rs, roi_over)
        W("| %s | %s | %d | %d | %.2f %% | %+.2f %% | [%+.2f %% ; %+.2f %%] |" % (
            s, a, len(rs), nm(rs), mean(r["res"] for r in rs) * 100,
            roi_over(rs) * 100, lo * 100, hi * 100))
    rs = [r for r in rows if seau(r["rel"]) == s]
    lo, hi = bootstrap_by_match(rs, roi_over)
    W("| **%s** | *toutes* | **%d** | **%d** | %.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
        s, len(rs), nm(rs), mean(r["res"] for r in rs) * 100,
        roi_over(rs) * 100, lo * 100, hi * 100))
W()

# ---------- 6. Une ligne par match ----------
W("## A6 - Une seule ligne par match (la plus basse disponible)")
W()
best = {}
for r in rows:
    k = r["match_id"]
    if k not in best or r["total"] < best[k]["total"]:
        best[k] = r
sel = list(best.values())
W("| perimetre | paris | matchs | P(over) realise | ROI over | IC 95 % |")
W("|---|---|---|---|---|---|")


def r6(lbl, rs):
    lo, hi = bootstrap_by_match(rs, roi_over)
    W("| %s | %d | %d | %.2f %% | %+.2f %% | [%+.2f %% ; %+.2f %%] |" % (
        lbl, len(rs), nm(rs), mean(r["res"] for r in rs) * 100,
        roi_over(rs) * 100, lo * 100, hi * 100))


r6("**global**", sel)
for a in sorted({r["annee"] for r in sel}):
    r6("annee " + a, [r for r in sel if r["annee"] == a])
W()

# ---------- 7. La cloture ----------
W("## A7 - La cloture (descriptif)")
W()
p_c = mean(devig(r["co_c"], r["cu_c"]) for r in rows)
o_r = mean(r["res"] for r in rows)
W("| perimetre | lignes | P(over) implicite cloture | over realise | ecart |")
W("|---|---|---|---|---|")
W("| **global** | %d | %.2f %% | %.2f %% | %+.2f pts |" % (len(rows), p_c * 100, o_r * 100, (o_r - p_c) * 100))
for a in sorted({r["annee"] for r in rows}):
    rs = [r for r in rows if r["annee"] == a]
    pc = mean(devig(r["co_c"], r["cu_c"]) for r in rs)
    orr = mean(r["res"] for r in rs)
    W("| annee %s | %d | %.2f %% | %.2f %% | %+.2f pts |" % (a, len(rs), pc * 100, orr * 100, (orr - pc) * 100))
W()
bouge = [r for r in rows if abs(r["co_c"] - r["co_o"]) > 0.01]
W("Lignes dont la cote over a bouge de plus de 0,01 entre ouverture et cloture : "
  "**%d / %d = %.2f %%**." % (len(bouge), len(rows), len(bouge) / len(rows) * 100))
W()
W("| annee | lignes | cote over bougee > 0,01 | part |")
W("|---|---|---|---|")
for a in sorted({r["annee"] for r in rows}):
    rs = [r for r in rows if r["annee"] == a]
    b = [r for r in rs if abs(r["co_c"] - r["co_o"]) > 0.01]
    W("| %s | %d | %d | %.2f %% |" % (a, len(rs), len(b), len(b) / len(rs) * 100))
W()
clv = [devig(r["co_c"], r["cu_c"]) * r["co_o"] - 1.0 for r in rows]
W("**CLV over descriptive** `P_over_cloture_devig x cote_over_ouverture - 1`, "
  "moyenne globale : **%+.3f %%**." % (mean(clv) * 100))
W()
W("| annee | lignes | CLV over moyenne |")
W("|---|---|---|")
for a in sorted({r["annee"] for r in rows}):
    rs = [r for r in rows if r["annee"] == a]
    W("| %s | %d | %+.3f %% |" % (a, len(rs),
      mean(devig(r["co_c"], r["cu_c"]) * r["co_o"] - 1.0 for r in rs) * 100))
W()
W("*Rappel protocole : la cloture des totaux n'est pas un arbitre. Section descriptive.*")

path = os.path.join(ROOT, "run4-totaux", "out", "partie-a.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
