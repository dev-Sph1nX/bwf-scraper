"""Moteur : Elo causal par discipline + table de features par match.

L'Elo est recalcule ici en Python (stdlib) plutot que lu du depot, pour que
run4-totaux soit reproductible seul. Parametres repris de lib/elo.mjs
(initial 1500, k 32, kProvisional 48 sous 5 matchs, multiplicateur 0,85 pour
un match en 3 manches, seed lineaire par rang mondial top-60, seed d'une paire
neuve depuis les notes individuelles de ses joueurs, poids 1 / min 10).

Toutes les notes lues pour un match sont AVANT ce match : l'ordre de traitement
est chronologique et la mise a jour vient apres la lecture.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import read_csv, f, i, EXPORT, ROOT

INITIAL = 1500.0
K = 32.0
K_PROV = 48.0
PROV_MATCHES = 5
THREE_SET_MULT = 0.85
SEED_TOP, SEED_BOTTOM, SEED_TOPN = 1750.0, 1350.0, 60
PAIR_SEED_W = 1.0
PAIR_SEED_MIN = 10
SCALE = 400.0

ORDRE_TOUR = {
    "Qual. R32": 0, "Qual. R16": 1, "Qual. QF": 2,
    "R64": 3, "R32": 4, "R16": 5, "QF": 6, "SF": 7, "Final": 8,
    "R1": 4, "R2": 5, "R3": 6, "": 4,
}


def seed_par_rang(rang):
    if not rang or rang > SEED_TOPN:
        return SEED_BOTTOM
    return round(SEED_TOP - (rang - 1) * (SEED_TOP - SEED_BOTTOM) / (SEED_TOPN - 1))


def joueurs_de(entite):
    return [x for x in entite.split(":", 1)[1].split("-")]


def esperance(ra, rb):
    return 1.0 / (1.0 + 10.0 ** ((rb - ra) / SCALE))


def charger_matchs():
    ms = read_csv("matches.csv")
    for m in ms:
        m["_ordre"] = ORDRE_TOUR.get(m["tour"], 4)
        m["_pts"] = i(m["points1"]) + i(m["points2"])
        m["_rang1"] = i(m["rang1"])
        m["_rang2"] = i(m["rang2"])
        m["_manches"] = i(m["manches"])
        m["_duree"] = f(m["duree_min"])
    ms.sort(key=lambda m: (m["date"], m["_ordre"], m["match_id"]))
    return ms


def calcule_elo(matchs):
    """Ajoute a chaque match elo1, elo2 (avant-match) et n1, n2 (matchs joues)."""
    notes = {}     # (discipline, entite) -> [rating, nb_matchs]
    solo = {}      # (discipline, joueur)  -> [rating, nb_matchs]  (double seulement)

    def note(disc, ent, rang):
        cle = (disc, ent)
        if cle not in notes:
            base = float(seed_par_rang(rang))
            if ent.startswith("pair:") and PAIR_SEED_W > 0:
                utiles = [solo[(disc, j)] for j in joueurs_de(ent)
                          if (disc, j) in solo and solo[(disc, j)][1] >= PAIR_SEED_MIN]
                if utiles:
                    derivee = sum(x[0] for x in utiles) / len(utiles)
                    conf = len(utiles) / float(len(joueurs_de(ent)))
                    base = base + PAIR_SEED_W * conf * (derivee - base)
            notes[cle] = [base, 0]
        return notes[cle]

    def note_solo(disc, j, rang):
        cle = (disc, j)
        if cle not in solo:
            solo[cle] = [float(seed_par_rang(rang)), 0]
        return solo[cle]

    for m in matchs:
        d, e1, e2 = m["discipline"], m["equipe1_id"], m["equipe2_id"]
        n1, n2 = note(d, e1, m["_rang1"]), note(d, e2, m["_rang2"])
        m["elo1"], m["elo2"] = n1[0], n2[0]
        m["nmatch1"], m["nmatch2"] = n1[1], n2[1]

        s1 = 1.0 if m["vainqueur"] == "1" else 0.0
        att = esperance(n1[0], n2[0])
        mult = THREE_SET_MULT if m["_manches"] == 3 else 1.0
        k1 = (K_PROV if n1[1] < PROV_MATCHES else K) * mult
        k2 = (K_PROV if n2[1] < PROV_MATCHES else K) * mult
        delta = s1 - att
        n1[0] += k1 * delta
        n2[0] -= k2 * delta
        n1[1] += 1
        n2[1] += 1

        # notes individuelles de double : servent au seed d'une paire neuve
        if e1.startswith("pair:"):
            for ent, rang, s in ((e1, m["_rang1"], s1), (e2, m["_rang2"], 1.0 - s1)):
                for j in joueurs_de(ent):
                    sj = note_solo(d, j, rang)
                    kj = (K_PROV if sj[1] < PROV_MATCHES else K) * mult
                    sj[0] += kj * (s - att if ent == e1 else s - (1.0 - att))
                    sj[1] += 1
    return matchs


# ---------------------------------------------------------------- features

def moyennes_causales(matchs, demi_vie=30.0, prior_poids=8.0):
    """Moyenne glissante EXPONENTIELLE du total de points d'une entite, lue
    AVANT le match, amortie vers la moyenne de la discipline (elle-meme
    causale). demi_vie en nombre de matchs de l'entite."""
    lam = 0.5 ** (1.0 / demi_vie)
    ent = {}          # (disc, entite) -> [somme_ponderee, poids]
    disc_s, disc_n = {}, {}   # moyenne causale de la discipline

    for m in matchs:
        d = m["discipline"]
        base = disc_s.get(d, 0.0) / disc_n[d] if disc_n.get(d) else 80.0
        for suff, e in (("1", m["equipe1_id"]), ("2", m["equipe2_id"])):
            st = ent.get((d, e))
            if st and st[1] > 0:
                moy = st[0] / st[1]
                w = st[1]
            else:
                moy, w = base, 0.0
            m["tp" + suff] = (w * moy + prior_poids * base) / (w + prior_poids)
            m["tpn" + suff] = w
        # mise a jour APRES lecture
        for e in (m["equipe1_id"], m["equipe2_id"]):
            st = ent.setdefault((d, e), [0.0, 0.0])
            st[0] = st[0] * lam + m["_pts"]
            st[1] = st[1] * lam + 1.0
        disc_s[d] = disc_s.get(d, 0.0) + m["_pts"]
        disc_n[d] = disc_n.get(d, 0) + 1
    return matchs


DISCIPLINES = ["MD", "MS", "WD", "WS", "XD"]


def features(m):
    """Vecteur de features d'un match. Aucune n'utilise le resultat du match
    ni la moindre cote."""
    gap = abs(m["elo1"] - m["elo2"])
    niveau = (m["elo1"] + m["elo2"]) / 2.0
    x = [1.0]
    x += [1.0 if m["discipline"] == d else 0.0 for d in DISCIPLINES[1:]]  # MD = reference
    x.append(gap / 100.0)
    x.append(min(gap, 400.0) ** 2 / 10000.0)
    x.append((niveau - 1500.0) / 100.0)
    x.append((m["tp1"] + m["tp2"]) / 2.0 - 80.0)
    x.append(1.0 if m["_ordre"] >= 6 else 0.0)          # QF et au-dela
    x.append(1.0 if m["_ordre"] <= 2 else 0.0)          # qualifications
    x.append(1.0 if min(m["nmatch1"], m["nmatch2"]) < 5 else 0.0)  # entite neuve
    return x


NOMS_FEATURES = ["const", "d_MS", "d_WD", "d_WS", "d_XD", "gap/100", "gap2",
                 "niveau", "tp_moy-80", "tour_haut", "qualif", "neuve"]


def prepare():
    ms = charger_matchs()
    calcule_elo(ms)
    moyennes_causales(ms)
    return ms
