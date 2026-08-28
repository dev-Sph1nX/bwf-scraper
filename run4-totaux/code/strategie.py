"""Machinerie de strategie : seaux de ligne relative, placebo par cellule,
tirage a blanc a profil identique. Partagee entre la calibration 2025 et le
test 2026 : le meme code produit les deux, seule la periode change.
"""
import os, sys, random, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import roi_over, roi_under, nm, mean, bootstrap_by_match, pct, SEED

SEAUX = ["rel <= -2", "-2 < rel < +2", "rel >= +2"]


def seau(rel):
    if rel <= -2:
        return SEAUX[0]
    if rel >= 2:
        return SEAUX[2]
    return SEAUX[1]


def medianes_disciplines(toutes_lignes):
    """Mediane des lignes misables par discipline, TOUTES annees (definition
    figee, identique a la partie A)."""
    med = {}
    for d in sorted({r["disc"] for r in toutes_lignes}):
        med[d] = statistics.median([r["total"] for r in toutes_lignes if r["disc"] == d])
    return med


def annote_cellules(lignes, med):
    for r in lignes:
        r["rel"] = r["total"] - med[r["disc"]]
        r["cell"] = (seau(r["rel"]), r["disc"])
    return lignes


def placebos(univers):
    """ROI over moyen de chaque cellule, calcule SUR LA PERIODE EVALUEE."""
    par_cell = {}
    for r in univers:
        par_cell.setdefault(r["cell"], []).append(r)
    return {c: roi_over(v) for c, v in par_cell.items()}, {c: len(v) for c, v in par_cell.items()}


def placebo_attendu(sel, plac):
    """Placebo pondere par le profil de cellules de la selection."""
    if not sel:
        return float("nan")
    return sum(plac.get(r["cell"], 0.0) for r in sel) / len(sel)


def roi_net(sel, plac):
    return roi_over(sel) - placebo_attendu(sel, plac)


def ic_roi_net(sel, plac, nboot=2000, seed=SEED):
    return bootstrap_by_match(sel, lambda rs: roi_net(rs, plac), nboot=nboot, seed=seed)


def ic_roi_over(sel, nboot=2000, seed=SEED):
    return bootstrap_by_match(sel, roi_over, nboot=nboot, seed=seed)


def profil(sel):
    """[(cell, nb_lignes)] par match de la selection."""
    par_match = {}
    for r in sel:
        par_match.setdefault(r["match_id"], []).append(r)
    out = []
    for mid, rs in par_match.items():
        c = {}
        for r in rs:
            c[r["cell"]] = c.get(r["cell"], 0) + 1
        out.append(sorted(c.items()))
    return out


def tirage_a_blanc(sel, univers, seed=SEED):
    """Selection aleatoire de meme taille, meme profil (cellule x lignes par
    match). Pour chaque match de la strategie on tire un match de l'univers
    capable de fournir le meme nombre de lignes dans les memes cellules."""
    rng = random.Random(seed)
    par_match = {}
    for r in univers:
        par_match.setdefault(r["match_id"], []).append(r)
    ids = sorted(par_match.keys())
    faux = []
    for besoins in profil(sel):
        for _ in range(400):
            cand = par_match[ids[rng.randrange(len(ids))]]
            dispo = {}
            for r in cand:
                dispo.setdefault(r["cell"], []).append(r)
            if all(len(dispo.get(c, [])) >= k for c, k in besoins):
                for c, k in besoins:
                    faux.extend(rng.sample(dispo[c], k))
                break
        else:
            # aucun match compatible trouve : on tire ligne a ligne dans la cellule
            par_cell = {}
            for r in univers:
                par_cell.setdefault(r["cell"], []).append(r)
            for c, k in besoins:
                pool = par_cell.get(c, [])
                if pool:
                    faux.extend(rng.sample(pool, min(k, len(pool))))
    return faux


def selection(lignes, s_over, s_under=None):
    """Regle de pari. `ecart` = p_mod - p_marche_ouverture."""
    ov = [r for r in lignes if r["ecart"] >= s_over]
    un = [r for r in lignes if s_under is not None and r["ecart"] <= -s_under]
    return ov, un


def tirage_a_blanc_strict(sel, univers, seed=SEED):
    """Tirage a blanc a profil de barreaux STRICT (correction de H14).

    Pour chaque match parie : on tire un match de l'univers ayant exactement le
    meme nombre de lignes dans l'univers, puis on y prend au hasard le meme
    nombre de lignes. Le profil de lignes-par-match est donc exact ; le profil
    de cellules est corrige, comme pour la selection reelle, par la
    soustraction du placebo.
    """
    rng = random.Random(seed)
    par_match = {}
    for r in univers:
        par_match.setdefault(r["match_id"], []).append(r)
    par_taille = {}
    for mid, rs in par_match.items():
        par_taille.setdefault(len(rs), []).append(mid)
    for t in par_taille:
        par_taille[t].sort()

    mises = {}
    for r in sel:
        mises[r["match_id"]] = mises.get(r["match_id"], 0) + 1

    faux = []
    for mid, k in sorted(mises.items()):
        taille = len(par_match[mid])
        pool = par_taille.get(taille)
        if not pool:                      # jamais atteint sur nos donnees
            pool = sorted(par_match.keys())
        src = par_match[pool[rng.randrange(len(pool))]]
        faux.extend(rng.sample(src, min(k, len(src))))
    return faux
