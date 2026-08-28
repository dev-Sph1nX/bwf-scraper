"""Modele du total de points, regle sur les RESULTATS 2022-2024 uniquement.

Aucune cote, d'aucun marche, n'entre ici : ni en cible, ni en feature, ni en
poids. Les seules entrees sont matches.csv (score, discipline, tour, rang) et
l'Elo causal derive de ces memes matchs.

Structure :
    P(total > L) = P3 * S3(L - mu3) + (1 - P3) * S2(L - mu2)
  - P3   : logistique, P(le match va en 3 manches)
  - mu2  : moindres carres, E[total | 2 manches]
  - mu3  : moindres carres, E[total | 3 manches]
  - S2/S3: survie EMPIRIQUE des residus d'entrainement (interpolee lineairement)

Ce decoupage vient de la structure des donnees : un match en 2 manches fait
39-100 points, un match en 3 manches 86-146. Les deux nuages se touchent a
peine, donc c'est P3 qui porte l'essentiel du signal, et la position dans le
nuage qui affine.
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moteur import prepare, features, NOMS_FEATURES

ANNEES_REGLAGE = ("2022", "2023", "2024")


# ------------------------------------------------------------ algebre lineaire
def resous(A, b):
    """Systeme lineaire dense, pivot partiel. A modifie en place."""
    n = len(A)
    M = [row[:] + [b[k]] for k, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12:
            raise ValueError("matrice singuliere colonne %d" % c)
        M[c], M[p] = M[p], M[c]
        piv = M[c][c]
        for r in range(n):
            if r == c:
                continue
            fac = M[r][c] / piv
            if fac == 0.0:
                continue
            for k in range(c, n + 1):
                M[r][k] -= fac * M[c][k]
    return [M[c][n] / M[c][c] for c in range(n)]


def moindres_carres(X, y, ridge=1e-6):
    n = len(X[0])
    A = [[0.0] * n for _ in range(n)]
    b = [0.0] * n
    for xi, yi in zip(X, y):
        for a in range(n):
            xa = xi[a]
            if xa == 0.0:
                continue
            for c in range(n):
                A[a][c] += xa * xi[c]
            b[a] += xa * yi
    for a in range(n):
        A[a][a] += ridge
    return resous(A, b)


def logistique(X, y, ridge=1e-4, iters=40):
    """Newton-Raphson (IRLS)."""
    n = len(X[0])
    w = [0.0] * n
    for _ in range(iters):
        g = [0.0] * n
        H = [[0.0] * n for _ in range(n)]
        for xi, yi in zip(X, y):
            z = sum(a * b for a, b in zip(w, xi))
            p = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))
            r = yi - p
            s = max(p * (1.0 - p), 1e-9)
            for a in range(n):
                xa = xi[a]
                if xa == 0.0:
                    continue
                g[a] += xa * r
                for c in range(n):
                    H[a][c] += xa * xi[c] * s
        for a in range(n):
            H[a][a] += ridge
            g[a] -= ridge * w[a]
        d = resous(H, g)
        w = [wa + da for wa, da in zip(w, d)]
        if max(abs(x) for x in d) < 1e-9:
            break
    return w


def dot(w, x):
    return sum(a * b for a, b in zip(w, x))


def sigm(z):
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


# ------------------------------------------------------------- survie empirique
class Survie:
    """P(residu > r), interpolation lineaire sur les residus tries."""

    def __init__(self, residus):
        self.v = sorted(residus)
        self.n = len(self.v)

    def __call__(self, r):
        v, n = self.v, self.n
        if r < v[0]:
            return 1.0
        if r >= v[-1]:
            return 0.0
        lo, hi = 0, n - 1
        while lo < hi:                      # premier indice tel que v[idx] > r
            mid = (lo + hi) // 2
            if v[mid] > r:
                hi = mid
            else:
                lo = mid + 1
        idx = lo
        # lissage : interpole entre les deux valeurs encadrantes
        vg, vd = v[idx - 1], v[idx]
        frac = 0.0 if vd == vg else (r - vg) / (vd - vg)
        s_g = (n - idx) / float(n)
        s_d = (n - idx - 1) / float(n)
        return s_g + frac * (s_d - s_g)

    def dump(self, k=201):
        """Quantiles pour serialisation."""
        return [round(self.v[min(self.n - 1, int(round(q * (self.n - 1) / (k - 1.0))))], 4)
                for q in range(k)]


# ------------------------------------------------------------------- le modele
class ModelePoints:
    def __init__(self, matchs_reglage):
        X = [features(m) for m in matchs_reglage]
        y3 = [1.0 if m["_manches"] == 3 else 0.0 for m in matchs_reglage]
        self.w3 = logistique(X, y3)

        m2 = [m for m in matchs_reglage if m["_manches"] == 2]
        m3 = [m for m in matchs_reglage if m["_manches"] == 3]
        X2, Y2 = [features(m) for m in m2], [float(m["_pts"]) for m in m2]
        X3, Y3 = [features(m) for m in m3], [float(m["_pts"]) for m in m3]
        self.b2 = moindres_carres(X2, Y2)
        self.b3 = moindres_carres(X3, Y3)
        self.s2 = Survie([yi - dot(self.b2, xi) for xi, yi in zip(X2, Y2)])
        self.s3 = Survie([yi - dot(self.b3, xi) for xi, yi in zip(X3, Y3)])
        self.n_reglage = len(matchs_reglage)

    def parts(self, m):
        x = features(m)
        return sigm(dot(self.w3, x)), dot(self.b2, x), dot(self.b3, x)

    def p_over(self, m, ligne):
        p3, mu2, mu3 = self.parts(m)
        return (1.0 - p3) * self.s2(ligne - mu2) + p3 * self.s3(ligne - mu3)

    def to_json(self):
        return {
            "features": NOMS_FEATURES,
            "w_p3": [round(v, 6) for v in self.w3],
            "b_mu2": [round(v, 6) for v in self.b2],
            "b_mu3": [round(v, 6) for v in self.b3],
            "residus_2manches_quantiles": self.s2.dump(),
            "residus_3manches_quantiles": self.s3.dump(),
            "n_matchs_reglage": self.n_reglage,
            "annees_reglage": list(ANNEES_REGLAGE),
        }


def construit():
    ms = prepare()
    reglage = [m for m in ms if m["saison"] in ANNEES_REGLAGE]
    return ms, ModelePoints(reglage)


if __name__ == "__main__":
    ms, mod = construit()
    print("regle sur %d matchs %s" % (mod.n_reglage, "/".join(ANNEES_REGLAGE)))
    for nom, w in (("P3", mod.w3), ("mu2", mod.b2), ("mu3", mod.b3)):
        print(nom, ", ".join("%s=%.4f" % (n, v) for n, v in zip(NOMS_FEATURES, w)))
