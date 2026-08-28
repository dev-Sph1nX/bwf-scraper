"""TEST 2026 — ouverture unique du scelle. Charge modele-final.json et
n'y touche pas. Aucune reestimation."""
import os, sys, math, json, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, sigm
import strategie as st

FINAL = json.load(open(os.path.join(ROOT, "run4-totaux", "modele-final.json")))
PA = FINAL["calibration_platt"]["a"]
PB = FINAL["calibration_platt"]["b"]
S = FINAL["strategie"]["s_over"]
MED = FINAL["seaux"]["medianes"]

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
toutes, _, _ = load_totaux()
st.annote_cellules(toutes, MED)


def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


for r in toutes:
    if r["match_id"] in par_id:
        r["p_mod"] = sigm(PA + PB * lg(mod.p_over(par_id[r["match_id"]], r["total"])))
        r["ecart"] = r["p_mod"] - devig(r["co_o"], r["cu_o"])

OUT = []
W = OUT.append
W("# Test 2026 — ouverture du scelle")
W("")
W("Modele et seuil charges depuis `modele-final.json` (commit 5ba007b). "
  "Seuil s = %.3f. Platt a = %.6f, b = %.6f. Rien n'est reestime." % (S, PA, PB))
W("")


def bloc(titre, annee):
    W("## %s" % titre)
    W("")
    univ = [r for r in toutes if r["annee"] == annee and "ecart" in r]
    plac, _ = st.placebos(univ)
    sel, _ = st.selection(univ, S)
    lo, hi = st.ic_roi_over(sel)
    nlo, nhi = st.ic_roi_net(sel, plac)
    W("| grandeur | valeur |")
    W("|---|---|")
    W("| univers : lignes misables %s | %d (%d matchs) |" % (annee, len(univ), nm(univ)))
    W("| **paris** | **%d** |" % len(sel))
    W("| **matchs distincts** | **%d** |" % nm(sel))
    W("| taux de selection | %.1f %% des lignes, %.1f %% des matchs |" % (
        len(sel) / float(len(univ)) * 100, nm(sel) / float(nm(univ)) * 100))
    W("| over realise sur la selection | %.2f %% |" % (mean(r["res"] for r in sel) * 100))
    W("| cote over moyenne prise | %.3f |" % mean(r["co_o"] for r in sel))
    W("| **ROI over** | **%+.2f %%** |" % (roi_over(sel) * 100))
    W("| IC 95 %% (bootstrap match, 2000, graine 42) | [%+.2f %% ; %+.2f %%] |" % (lo * 100, hi * 100))
    W("| placebo attendu (profil de cellules, periode %s) | %+.2f %% |" % (
        annee, st.placebo_attendu(sel, plac) * 100))
    W("| **ROI net du placebo** | **%+.2f %%** |" % (st.roi_net(sel, plac) * 100))
    W("| IC 95 %% du ROI net | [%+.2f %% ; %+.2f %%] |" % (nlo * 100, nhi * 100))
    W("| placebo global %s (over aveugle sur tout l'univers) | %+.2f %% |" % (
        annee, roi_over(univ) * 100))
    W("")
    return univ, plac, sel


univ26, plac26, sel26 = bloc("H11 — resultat brut sur 2026", "2026")

# --- placebos par cellule 2026
W("### Placebos par cellule, periode 2026")
W("")
W("| seau | discipline | lignes de l'univers | placebo ROI over | paris de la strategie |")
W("|---|---|---|---|---|")
cnt = {}
for r in sel26:
    cnt[r["cell"]] = cnt.get(r["cell"], 0) + 1
tail = {}
for r in univ26:
    tail[r["cell"]] = tail.get(r["cell"], 0) + 1
for c in sorted(plac26, key=lambda c: (st.SEAUX.index(c[0]), c[1])):
    W("| %s | %s | %d | %+.2f %% | %d |" % (c[0], c[1], tail[c], plac26[c] * 100, cnt.get(c, 0)))
W("")

# --- calibration du modele sur 2026
W("### Calibration du modele sur 2026 (tout l'univers, par decile)")
W("")
srt = sorted(univ26, key=lambda r: r["p_mod"])
N = len(srt)
W("| decile | lignes | matchs | P modele moy | over realise | ecart |")
W("|---|---|---|---|---|---|")
for k in range(10):
    part = srt[k * N // 10:(k + 1) * N // 10]
    pm, ob = mean(r["p_mod"] for r in part), mean(r["res"] for r in part)
    W("| %d | %d | %d | %.2f %% | %.2f %% | %+.2f pts |" % (
        k + 1, len(part), nm(part), pm * 100, ob * 100, (ob - pm) * 100))
W("")
W("Meme table pour la selection seule :")
W("")
srt = sorted(sel26, key=lambda r: r["p_mod"])
N2 = len(srt)
W("| quintile | paris | P modele moy | over realise | ecart | ROI over |")
W("|---|---|---|---|---|---|")
for k in range(5):
    part = srt[k * N2 // 5:(k + 1) * N2 // 5]
    pm, ob = mean(r["p_mod"] for r in part), mean(r["res"] for r in part)
    W("| %d | %d | %.2f %% | %.2f %% | %+.2f pts | %+.2f %% |" % (
        k + 1, len(part), pm * 100, ob * 100, (ob - pm) * 100, roi_over(part) * 100))
W("")

# --- H12 controle a blanc
W("## H12 — controle 1, tirage a blanc sur 2026")
W("")
faux = st.tirage_a_blanc(sel26, univ26, seed=42)
lo, hi = st.ic_roi_net(faux, plac26)
W("| tirage | paris | matchs | ROI over | placebo | ROI net | IC 95 % du net |")
W("|---|---|---|---|---|---|---|")
rlo, rhi = st.ic_roi_net(sel26, plac26)
W("| **reel** | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
    len(sel26), nm(sel26), roi_over(sel26) * 100, st.placebo_attendu(sel26, plac26) * 100,
    st.roi_net(sel26, plac26) * 100, rlo * 100, rhi * 100))
W("| a blanc (graine 42) | %d | %d | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] |" % (
    len(faux), nm(faux), roi_over(faux) * 100, st.placebo_attendu(faux, plac26) * 100,
    st.roi_net(faux, plac26) * 100, lo * 100, hi * 100))
W("")
nets = [st.roi_net(st.tirage_a_blanc(sel26, univ26, seed=1000 + g), plac26) for g in range(200)]
nets.sort()
sup = sum(1 for x in nets if x >= st.roi_net(sel26, plac26))
W("200 tirages a blanc (graines 1000-1199) : net moyen **%+.2f %%**, ecart-type "
  "%.2f pts, percentiles 2,5/97,5 [%+.2f %% ; %+.2f %%]. Tirages atteignant la "
  "selection reelle : **%d / 200** (p empirique %.3f)." % (
      mean(nets) * 100, statistics.pstdev(nets) * 100, pct(nets, 2.5) * 100,
      pct(nets, 97.5) * 100, sup, (sup + 1) / 201.0))
W("")

# --- H13 miroir
W("## H13 — controle 2, miroir (under des memes lignes)")
W("")
mg = mean(marge(r["co_o"], r["cu_o"]) for r in sel26)
somme = roi_over(sel26) + roi_under(sel26)
W("| grandeur | valeur |")
W("|---|---|")
W("| marge d'ouverture moyenne de la selection | %.3f %% |" % (mg * 100))
W("| ROI over | %+.2f %% |" % (roi_over(sel26) * 100))
W("| ROI under des memes lignes | %+.2f %% |" % (roi_under(sel26) * 100))
W("| **somme des deux jambes** | **%+.2f %%** |" % (somme * 100))
W("| attendu `-2m/(1+m)` | %+.2f %% |" % (-2 * mg / (1 + mg) * 100))
W("")
W("Jambe under symetrique (`ecart <= -%.3f`, desactivee dans la strategie gelee) :" % S)
W("")
un = [r for r in univ26 if r["ecart"] <= -S]
if un:
    ulo, uhi = bootstrap_by_match(un, roi_under)
    W("| paris | matchs | ROI under | IC 95 % |")
    W("|---|---|---|---|")
    W("| %d | %d | %+.2f %% | [%+.2f %% ; %+.2f %%] |" % (
        len(un), nm(un), roi_under(un) * 100, ulo * 100, uhi * 100))
W("")

# --- controle 3 : comptage + euro final
W("## Le chiffre en euros")
W("")
jours = sorted({r["date"] for r in univ26})
duree = (int(jours[-1][:4]) * 365 + int(jours[-1][5:7]) * 30 + int(jours[-1][8:10])) - \
        (int(jours[0][:4]) * 365 + int(jours[0][5:7]) * 30 + int(jours[0][8:10]))
an = duree / 365.0
lo, hi = st.ic_roi_over(sel26)
W("Periode couverte par les lignes 2026 : du %s au %s, soit **%.2f an**." % (jours[0], jours[-1], an))
W("")
W("| grandeur | valeur |")
W("|---|---|")
W("| paris sur la periode | %d |" % len(sel26))
W("| **paris par an** | **%d** |" % round(len(sel26) / an))
W("| mise | 100 EUR |")
W("| **esperance annuelle** | **%+d EUR** |" % round(len(sel26) / an * 100 * roi_over(sel26)))
W("| IC 95 %% de l'esperance annuelle | [%+d EUR ; %+d EUR] |" % (
    round(len(sel26) / an * 100 * lo), round(len(sel26) / an * 100 * hi)))
W("| capital engage par an | %d EUR |" % round(len(sel26) / an * 100))
W("")

# --- CLV descriptive
W("## CLV (descriptif seulement)")
W("")
clv = mean(devig(r["co_c"], r["cu_c"]) * r["co_o"] - 1.0 for r in sel26)
clvu = mean(devig(r["co_c"], r["cu_c"]) for r in sel26)
W("Sur la selection 2026 : P(over) de cloture de-viguee moyenne **%.2f %%**, "
  "cote over d'ouverture moyenne **%.3f**, **CLV over moyenne %+.2f %%**. "
  "L'over realise sur la selection est %.2f %%. La cloture ne voit donc pas ce "
  "que la selection voit : elle n'est pas un arbitre, conformement au protocole." % (
      clvu * 100, mean(r["co_o"] for r in sel26), clv * 100,
      mean(r["res"] for r in sel26) * 100))
W("")

# --- verdict mecanique
W("## Verdict mecanique du critere de succes")
W("")
ok1 = roi_over(sel26) > 0
ok2 = st.ic_roi_over(sel26)[0] > 0
ok3 = len(sel26) >= 300 and nm(sel26) >= 250
ok4 = lo <= 0 <= hi if False else (st.ic_roi_net(faux, plac26)[0] <= 0 <= st.ic_roi_net(faux, plac26)[1])
for lbl, ok in (("ROI > 0", ok1), ("IC 95 % groupe par match excluant zero", ok2),
                ("au moins 300 paris et 250 matchs", ok3),
                ("controle 1 passant (IC du tirage a blanc contient zero)", ok4)):
    W("- %s : **%s**" % (lbl, "OUI" if ok else "NON"))
W("")
W("**Protocole %s.**" % ("REUSSI" if (ok1 and ok2 and ok3 and ok4) else "ECHOUE"))

path = os.path.join(ROOT, "run4-totaux", "out", "test-2026.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
