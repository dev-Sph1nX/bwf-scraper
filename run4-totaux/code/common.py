"""Socle commun run4-totaux : lecture CSV, de-vig, bootstrap groupe par match.
stdlib pure, graine 42."""
import csv, os, random, math

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXPORT = os.path.join(ROOT, "export")
SEED = 42
NBOOT = 2000


def read_csv(name):
    with open(os.path.join(EXPORT, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def f(x):
    """float ou None si vide."""
    if x is None:
        return None
    x = x.strip()
    if x == "":
        return None
    try:
        return float(x)
    except ValueError:
        return None


def i(x):
    v = f(x)
    return None if v is None else int(v)


def discipline_of(match_id):
    return match_id.split("|")[1]


def annee(d):
    return d[:4]


def devig(o, u):
    """de-vig proportionnel : P(over)."""
    io, iu = 1.0 / o, 1.0 / u
    return io / (io + iu)


def marge(o, u):
    return 1.0 / o + 1.0 / u - 1.0


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float("nan")


def pct(sorted_vals, p):
    """percentile lineaire sur liste triee."""
    n = len(sorted_vals)
    if n == 0:
        return float("nan")
    k = (n - 1) * p / 100.0
    lo = int(math.floor(k))
    hi = int(math.ceil(k))
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] * (hi - k) + sorted_vals[hi] * (k - lo)


def bootstrap_by_match(rows, stat, nboot=NBOOT, seed=SEED):
    """rows : liste de dicts portant 'match_id'. stat : f(list_rows) -> float.
    Reechantillonne les match_id distincts avec remise, meme effectif."""
    by_m = {}
    for r in rows:
        by_m.setdefault(r["match_id"], []).append(r)
    keys = sorted(by_m.keys())
    n = len(keys)
    if n == 0:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    vals = []
    for _ in range(nboot):
        sample = []
        for _ in range(n):
            sample.extend(by_m[keys[rng.randrange(n)]])
        v = stat(sample)
        if v == v:  # pas NaN
            vals.append(v)
    vals.sort()
    return (pct(vals, 2.5), pct(vals, 97.5))


def nm(rs):
    """nombre de matchs distincts."""
    return len({r["match_id"] for r in rs})


def roi_over(rows):
    """ROI mise 1 sur over a l'ouverture."""
    if not rows:
        return float("nan")
    g = 0.0
    for r in rows:
        g += (r["co_o"] - 1.0) if r["res"] == 1 else -1.0
    return g / len(rows)


def roi_under(rows):
    if not rows:
        return float("nan")
    g = 0.0
    for r in rows:
        g += (r["cu_o"] - 1.0) if r["res"] == 0 else -1.0
    return g / len(rows)


def load_totaux():
    """Lignes misables, 4 cotes + resultat_over presents.
    Renvoie (retenues, dropped, n_raw)."""
    raw = read_csv("cotes-totaux.csv")
    kept = []
    dropped = {"non_misable": 0, "cote_manquante": 0, "resultat_manquant": 0}
    for r in raw:
        if r["misable"].strip().lower() != "true":
            dropped["non_misable"] += 1
            continue
        co_o, co_c = f(r["cote_over_ouverture"]), f(r["cote_over_cloture"])
        cu_o, cu_c = f(r["cote_under_ouverture"]), f(r["cote_under_cloture"])
        if None in (co_o, co_c, cu_o, cu_c):
            dropped["cote_manquante"] += 1
            continue
        res = i(r["resultat_over"])
        if res is None:
            dropped["resultat_manquant"] += 1
            continue
        kept.append({
            "match_id": r["match_id"], "date": r["date"], "book": r["book"],
            "annee": annee(r["date"]), "disc": discipline_of(r["match_id"]),
            "total": f(r["total"]), "points_total": f(r["points_total"]),
            "co_o": co_o, "co_c": co_c, "cu_o": cu_o, "cu_c": cu_c, "res": res,
        })
    return kept, dropped, len(raw)
