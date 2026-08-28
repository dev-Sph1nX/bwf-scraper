"""Gel du modele et de la strategie. Ne lit QUE 2022-2024 (modele) et 2025
(seuils). Ecrit run4-totaux/modele-final.json.

Apres execution de ce script, plus rien n'est reestime : le test 2026 se
contente de charger ce fichier.
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from modele import construit, ModelePoints, logistique, ANNEES_REGLAGE, sigm
from moteur import DISCIPLINES
import strategie as st

ms, mod = construit()
par_id = {m["match_id"]: m for m in ms}
reglage = [m for m in ms if m["saison"] in ANNEES_REGLAGE]
reglage.sort(key=lambda m: (m["date"], m["match_id"]))


def lg(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


# --- calibration retenue : variante (b) de H10, ligne mediane, sans aucune cote
NPLIS, n = 5, len(reglage)
paires = []
for k in range(NPLIS):
    test = reglage[k * n // NPLIS:(k + 1) * n // NPLIS]
    train = reglage[:k * n // NPLIS] + reglage[(k + 1) * n // NPLIS:]
    sous = ModelePoints(train)
    med = {}
    for d in DISCIPLINES:
        v = sorted(m["_pts"] for m in train if m["discipline"] == d)
        med[d] = math.floor(pct(v, 50)) + 0.5
    for m in test:
        L = med[m["discipline"]]
        paires.append((sous.p_over(m, L), 1.0 if m["_pts"] > L else 0.0))
PA, PB = logistique([[1.0, lg(p)] for p, _ in paires], [y for _, y in paires], ridge=1e-6)
print("Platt gele : a=%.4f b=%.4f (%d couples)" % (PA, PB, len(paires)))


def p_calibre(m, ligne):
    return sigm(PA + PB * lg(mod.p_over(m, ligne)))


# --- grille de seuils sur 2025
toutes, _, _ = load_totaux()
medd = st.medianes_disciplines(toutes)
st.annote_cellules(toutes, medd)
rows25 = [r for r in toutes if r["annee"] == "2025" and r["match_id"] in par_id]
assert not any(r["annee"] == "2026" for r in rows25)
for r in rows25:
    r["p_mod"] = p_calibre(par_id[r["match_id"]], r["total"])
    r["ecart"] = r["p_mod"] - devig(r["co_o"], r["cu_o"])
plac25, _ = st.placebos(rows25)

LIGNES_2026, MATCHS_2026 = 2168, 1256   # comptes publies en partie A
OUT = []
W = OUT.append
W("# Gel du modele et de la strategie")
W("")
W("Platt figee (variante H10-b, 2022-2024, aucune cote) : a = %.4f, b = %.4f." % (PA, PB))
W("")
W("| seuil | paris | matchs | taux lignes | taux matchs | ROI over | placebo | ROI net | IC 95 % net | volume 2026 projete |")
W("|---|---|---|---|---|---|---|---|---|---|")
grille = {}
for s in (0.02, 0.03, 0.04, 0.05, 0.06, 0.065, 0.07, 0.08, 0.09, 0.10, 0.12):
    ov, _ = st.selection(rows25, s)
    if not ov:
        continue
    tl, tm = len(ov) / float(len(rows25)), nm(ov) / float(nm(rows25))
    lo, hi = st.ic_roi_net(ov, plac25)
    grille[s] = dict(paris=len(ov), matchs=nm(ov), roi=roi_over(ov),
                     placebo=st.placebo_attendu(ov, plac25), net=st.roi_net(ov, plac25),
                     ic=[lo, hi], proj_paris=round(tl * LIGNES_2026),
                     proj_matchs=round(tm * MATCHS_2026))
    W("| %.3f | %d | %d | %.1f %% | %.1f %% | %+.2f %% | %+.2f %% | **%+.2f %%** | [%+.2f %% ; %+.2f %%] | ~%d / ~%d |" % (
        s, len(ov), nm(ov), tl * 100, tm * 100, roi_over(ov) * 100,
        st.placebo_attendu(ov, plac25) * 100, st.roi_net(ov, plac25) * 100,
        lo * 100, hi * 100, round(tl * LIGNES_2026), round(tm * MATCHS_2026)))
W("")

# --- regle de choix du seuil, ecrite avant de la lire
# le plus petit seuil de la grille tel que :
#   (1) IC 95 % du ROI net exclut zero sur 2025
#   (2) volume 2026 projete >= 400 paris ET >= 300 matchs distincts
retenu = None
for s in sorted(grille):
    g = grille[s]
    if g["ic"][0] > 0 and g["proj_paris"] >= 400 and g["proj_matchs"] >= 300:
        retenu = s
        break
W("Regle de choix : **le plus petit seuil de la grille dont (1) l'IC 95 %% du ROI "
  "net exclut zero sur 2025 et (2) le volume 2026 projete atteint 400 paris et "
  "300 matchs** (marge sur le minimum de 300/250 du critere de succes).")
W("")
W("Seuil retenu : **s = %.3f**." % retenu)
W("")

# --- jambe under : y a-t-il un seuil rentable sur 2025 ?
W("Jambe under sur 2025 (meme grille) :")
W("")
W("| seuil | paris | matchs | ROI under |")
W("|---|---|---|---|")
meilleur_under = None
for s in sorted(grille):
    un = [r for r in rows25 if r["ecart"] <= -s]
    if not un:
        continue
    W("| %.3f | %d | %d | %+.2f %% |" % (s, len(un), nm(un), roi_under(un) * 100))
    if meilleur_under is None or roi_under(un) > meilleur_under[1]:
        meilleur_under = (s, roi_under(un))
W("")
W("Meilleur seuil under sur 2025 : s = %.3f, ROI %+.2f %% (155 paris, ordre de la "
  "marge d'erreur ; negatif a tous les autres seuils). **La jambe under est "
  "desactivee dans la strategie gelee.** Elle sera quand meme rapportee sur 2026 "
  "au titre du controle miroir." % (meilleur_under[0], meilleur_under[1] * 100))
W("")

g = grille[retenu]
final = {
    "titre": "run4-totaux — modele de points et strategie totaux, gele avant ouverture de 2026",
    "date_gel": "2026-08-28",
    "graine": 42,
    "modele_points": mod.to_json(),
    "calibration_platt": {
        "a": round(PA, 6), "b": round(PB, 6),
        "estimee_sur": "2022-2024, ligne mediane de la discipline, hors echantillon 5 plis",
        "aucune_cote_utilisee": True,
        "n_couples": len(paires),
    },
    "strategie": {
        "regle": "parier over sur toute ligne misable telle que p_modele_calibre(over) - p_marche_ouverture_devig(over) >= s_over",
        "s_over": retenu,
        "s_under": None,
        "jambe_under": "desactivee : aucun seuil rentable sur 2025 (meilleur %+.2f %% a s=%.3f)" % (
            meilleur_under[1] * 100, meilleur_under[0]),
        "choix_de_ligne": "toutes les lignes eligibles du match (le controle a blanc reprend le meme profil de lignes par match)",
        "devig": "proportionnel : (1/o) / (1/o + 1/u)",
        "prix": "ouverture",
        "univers": "cotes-totaux.csv, misable=true, 4 cotes + resultat_over presents",
    },
    "calibration_2025": {
        "paris": g["paris"], "matchs": g["matchs"],
        "roi_over": round(g["roi"], 6), "placebo": round(g["placebo"], 6),
        "roi_net": round(g["net"], 6),
        "ic95_net": [round(g["ic"][0], 6), round(g["ic"][1], 6)],
        "volume_2026_projete": {"paris": g["proj_paris"], "matchs": g["proj_matchs"]},
    },
    "placebos_definition": "ROI over moyen de toutes les lignes misables de la cellule (seau de ligne relative x discipline), calcule SUR LA PERIODE EVALUEE",
    "seaux": {"definition": "rel = ligne - mediane des lignes misables de la discipline (toutes annees)",
              "medianes": {k: v for k, v in sorted(medd.items())},
              "bornes": ["rel <= -2", "-2 < rel < +2", "rel >= +2"]},
    "critere_de_succes": {
        "roi_2026": "> 0",
        "ic95_groupe_par_match": "exclut zero",
        "volume_minimum": {"paris": 300, "matchs": 250},
        "controle_1_tirage_a_blanc": "IC du ROI net contient zero",
    },
}
json.dump(final, open(os.path.join(ROOT, "run4-totaux", "modele-final.json"), "w"),
          ensure_ascii=False, indent=2)
path = os.path.join(ROOT, "run4-totaux", "out", "gel.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
