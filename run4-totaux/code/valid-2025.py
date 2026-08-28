"""Validation du modele et calibration de la strategie sur 2025 (H1, H2, H3).

INTERDIT ICI : toute lecture de 2026. Le script filtre explicitement.
"""
import os, sys, math, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit
from moteur import DISCIPLINES

ANNEE = os.environ.get("RUN4_ANNEE", "2025")
assert ANNEE == "2025", "ce script ne regarde que 2025"

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}

rows, dropped, n_raw = load_totaux()
rows = [r for r in rows if r["annee"] == ANNEE and r["match_id"] in par_id]
for r in rows:
    m = par_id[r["match_id"]]
    r["p_mod"] = mod.p_over(m, r["total"])
    r["p_mkt"] = devig(r["co_o"], r["cu_o"])
    r["p_mkt_c"] = devig(r["co_c"], r["cu_c"])
    r["ecart"] = r["p_mod"] - r["p_mkt"]
    r["disc"] = m["discipline"]

OUT = []
W = OUT.append

W("# Validation 2025 — modele de points contre la ligne Betclic")
W("")
W("Modele regle sur %d matchs 2022-2024. Lignes misables 2025 rattachees a un "
  "match : **%d** (%d matchs distincts)." % (mod.n_reglage, len(rows), nm(rows)))
W("")


def logloss(ps, ys):
    s = 0.0
    for p, y in zip(ps, ys):
        p = min(max(p, 1e-9), 1 - 1e-9)
        s -= y * math.log(p) + (1 - y) * math.log(1 - p)
    return s / len(ps)


ys = [float(r["res"]) for r in rows]
ll_mod = logloss([r["p_mod"] for r in rows], ys)
ll_mkt = logloss([r["p_mkt"] for r in rows], ys)
ll_mkt_c = logloss([r["p_mkt_c"] for r in rows], ys)
ll_cst = logloss([0.5] * len(rows), ys)
base = mean(ys)
ll_base = logloss([base] * len(rows), ys)

W("## H1 — log-loss sur les lignes 2025")
W("")
W("| predicteur | log-loss |")
W("|---|---|")
W("| constante 50 %% | %.4f |" % ll_cst)
W("| constante = taux d'over realise 2025 (%.1f %%, oracle) | %.4f |" % (base * 100, ll_base))
W("| marche, ouverture de-viguee | %.4f |" % ll_mkt)
W("| marche, cloture de-viguee | %.4f |" % ll_mkt_c)
W("| **modele (2022-2024, sans cote)** | **%.4f** |" % ll_mod)
W("")
W("Gain du modele sur le marche a l'ouverture : **%+.4f**." % (ll_mkt - ll_mod))
W("")

W("## H2 — le modele voit-il plus d'over que le marche ?")
W("")
W("| grandeur | moyenne |")
W("|---|---|")
W("| P(over) modele | %.2f %% |" % (mean(r["p_mod"] for r in rows) * 100))
W("| P(over) marche ouverture | %.2f %% |" % (mean(r["p_mkt"] for r in rows) * 100))
W("| **ecart moyen modele - marche** | **%+.2f pts** |" % (mean(r["ecart"] for r in rows) * 100))
W("| over realise | %.2f %% |" % (base * 100))
W("")

W("## Calibration du modele sur 2025, par decile de P(over) modele")
W("")
srt = sorted(rows, key=lambda r: r["p_mod"])
W("| decile | lignes | matchs | P modele moy | over realise | ecart |")
W("|---|---|---|---|---|---|")
n = len(srt)
for k in range(10):
    part = srt[k * n // 10:(k + 1) * n // 10]
    pm = mean(r["p_mod"] for r in part)
    ob = mean(r["res"] for r in part)
    W("| %d | %d | %d | %.2f %% | %.2f %% | %+.2f pts |" % (
        k + 1, len(part), nm(part), pm * 100, ob * 100, (ob - pm) * 100))
W("")
W("Meme table pour le marche a l'ouverture :")
W("")
srt2 = sorted(rows, key=lambda r: r["p_mkt"])
W("| decile | lignes | P marche moy | over realise | ecart |")
W("|---|---|---|---|---|")
for k in range(10):
    part = srt2[k * n // 10:(k + 1) * n // 10]
    pm = mean(r["p_mkt"] for r in part)
    ob = mean(r["res"] for r in part)
    W("| %d | %d | %.2f %% | %.2f %% | %+.2f pts |" % (k + 1, len(part), pm * 100, ob * 100, (ob - pm) * 100))
W("")

W("## H3 — ROI over par decile d'ecart modele - marche")
W("")
srt3 = sorted(rows, key=lambda r: r["ecart"])
W("| decile d'ecart | lignes | matchs | ecart moyen | P(over) realise | ROI over | ROI under |")
W("|---|---|---|---|---|---|---|")
for k in range(10):
    part = srt3[k * n // 10:(k + 1) * n // 10]
    W("| %d | %d | %d | %+.2f pts | %.2f %% | %+.2f %% | %+.2f %% |" % (
        k + 1, len(part), nm(part), mean(r["ecart"] for r in part) * 100,
        mean(r["res"] for r in part) * 100, roi_over(part) * 100, roi_under(part) * 100))
W("")

W("## Grille de seuils (calibration de la strategie sur 2025)")
W("")
W("Regle : parier **over** si `ecart >= +s`, **under** si `ecart <= -s`. "
  "Une ligne = un pari (toutes les lignes du match retenues).")
W("")
W("| seuil s | paris over | ROI over | paris under | ROI under | paris total | matchs | ROI total |")
W("|---|---|---|---|---|---|---|---|")
for s in (0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.15):
    ov = [r for r in rows if r["ecart"] >= s]
    un = [r for r in rows if r["ecart"] <= -s]
    tot = ov + un
    g = sum((r["co_o"] - 1.0) if r["res"] == 1 else -1.0 for r in ov)
    g += sum((r["cu_o"] - 1.0) if r["res"] == 0 else -1.0 for r in un)
    W("| %.2f | %d | %s | %d | %s | %d | %d | %s |" % (
        s, len(ov), ("%+.2f %%" % (roi_over(ov) * 100)) if ov else "-",
        len(un), ("%+.2f %%" % (roi_under(un) * 100)) if un else "-",
        len(tot), nm(tot) if tot else 0,
        ("%+.2f %%" % (g / len(tot) * 100)) if tot else "-"))
W("")

W("## Choix de ligne quand un match en propose plusieurs (seuil 0,05, over seul)")
W("")
for nom, keyf in (("toutes les lignes eligibles", None),
                  ("la ligne la plus basse du match", lambda rs: min(rs, key=lambda r: r["total"])),
                  ("la ligne au plus fort ecart", lambda rs: max(rs, key=lambda r: r["ecart"])),
                  ("la ligne la plus haute du match", lambda rs: max(rs, key=lambda r: r["total"]))):
    pass
W("| regle de choix | seuil | paris | matchs | ROI over |")
W("|---|---|---|---|---|")
for s in (0.03, 0.05, 0.07):
    elig = [r for r in rows if r["ecart"] >= s]
    grp = {}
    for r in elig:
        grp.setdefault(r["match_id"], []).append(r)
    variantes = [
        ("toutes les lignes eligibles", elig),
        ("la plus basse eligible", [min(v, key=lambda r: r["total"]) for v in grp.values()]),
        ("le plus fort ecart", [max(v, key=lambda r: r["ecart"]) for v in grp.values()]),
        ("la plus haute eligible", [max(v, key=lambda r: r["total"]) for v in grp.values()]),
    ]
    for nom, sel in variantes:
        if not sel:
            continue
        W("| %s | %.2f | %d | %d | %+.2f %% |" % (nom, s, len(sel), nm(sel), roi_over(sel) * 100))
W("")

path = os.path.join(ROOT, "run4-totaux", "out", "valid-2025.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
