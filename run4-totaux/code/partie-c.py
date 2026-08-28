"""Partie C — disponibilite des prix, sur data/books/runs/ (344 instantanes
horodates depuis le 2026-07-31). Descriptif pre-enregistre, sans decision.
"""
import os, sys, json, glob, csv, statistics, datetime, unicodedata, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, mean, pct, f as tofloat

RUNS = os.path.join(ROOT, "data", "books", "runs")
OUT = []
W = OUT.append


def ts(s):
    return datetime.datetime.strptime(s.replace("Z", ""), "%Y-%m-%dT%H:%M:%S.%f")


fichiers = sorted(glob.glob(os.path.join(RUNS, "*.json")))
snaps = []
for fp in fichiers:
    d = json.load(open(fp, encoding="utf-8"))
    snaps.append((ts(d["fetchedAt"]), os.path.basename(fp), d))

W("# Partie C — la disponibilite des prix")
W("")
W("Source : `data/books/runs/`, **%d instantanes** du %s au %s." % (
    len(snaps), snaps[0][0].strftime("%Y-%m-%d %H:%M"), snaps[-1][0].strftime("%Y-%m-%d %H:%M")))
W("")

# ---------------------------------------------------------------- 1. inventaire
lignes = []
for t, nom, d in snaps:
    for book, v in d["books"].items():
        for r in v.get("rows", []):
            r = dict(r)
            r["_t"] = t
            lignes.append(r)
vides = sum(1 for t, n, d in snaps if not sum(len(b.get("rows", [])) for b in d["books"].values()))
gaps = [(snaps[i + 1][0] - snaps[i][0]).total_seconds() / 3600.0 for i in range(len(snaps) - 1)]
W("## C1 — inventaire")
W("")
W("| grandeur | valeur |")
W("|---|---|")
W("| instantanes | %d |" % len(snaps))
W("| instantanes sans aucune ligne | %d (%.1f %%) |" % (vides, vides / len(snaps) * 100))
W("| lignes-instantane totales | %d |" % len(lignes))
W("| cadence : ecart median entre deux instantanes | %.2f h |" % statistics.median(gaps))
W("| cadence : 1er / 9e decile | %.2f h / %.2f h |" % (pct(sorted(gaps), 10), pct(sorted(gaps), 90)))
W("")
par_book = {}
for r in lignes:
    par_book.setdefault(r["book"], []).append(r)
W("| operateur | lignes-instantane | matchs distincts (srId) | instantanes ou il apparait |")
W("|---|---|---|---|")
for b in sorted(par_book):
    rs = par_book[b]
    W("| %s | %d | %d | %d |" % (b, len(rs), len({r["srId"] for r in rs}), len({r["_t"] for r in rs})))
W("")

# ------------------------------------------------------- 2. marches presents
cles = {}
for r in lignes:
    for k in r:
        if k != "_t":
            cles[k] = cles.get(k, 0) + 1
W("## C2 — quels marches sont reellement releves")
W("")
W("Recensement **exhaustif** des champs presents sur les %d lignes-instantane :" % len(lignes))
W("")
W("| champ | occurrences | part |")
W("|---|---|---|")
for k in sorted(cles, key=lambda k: -cles[k]):
    W("| `%s` | %d | %.1f %% |" % (k, cles[k], cles[k] / len(lignes) * 100))
W("")
sous = {}
for r in lignes:
    if "sets" in r:
        for k in r["sets"]:
            sous[k] = sous.get(k, 0) + 1
W("Sous-champs de `sets` : %s." % ", ".join("`%s` %d" % (k, v) for k, v in sorted(sous.items())))
W("")
W("> **Aucun champ de total de points n'existe dans ces relevés.** Le schema "
  "normalise de `lib/books.mjs` porte le marche vainqueur (`odd1`, `odd2`) et, "
  "depuis le 2026-08-10, le marche « nombre de sets » (`sets`). Le marche "
  "over/under du total de points n'y a jamais ete collecte.")
W("")
W("**Consequence directe : les trois questions de la partie C portant sur les "
  "lignes de totaux — delai d'apparition, duree de vie d'un prix, mouvement de "
  "la ligne — sont sans reponse dans ce depot.** Ce n'est pas un trou de "
  "couverture qu'on pourrait combler en cherchant mieux : la donnee n'a pas ete "
  "captee. Tout ce qui suit porte donc sur le marche **vainqueur**, que la "
  "commande demandait « pour comparaison », et sur le marche **sets**.")
W("")

# ------------------------------------------- 3. series par (operateur, match)
nuls = sum(1 for r in lignes if not isinstance(r.get("odd1"), (int, float))
           or not isinstance(r.get("odd2"), (int, float)))
series = {}
for r in lignes:
    if not isinstance(r.get("odd1"), (int, float)):
        continue
    series.setdefault((r["book"], r["srId"]), []).append(r)
for k in series:
    series[k].sort(key=lambda r: r["_t"])

W("## C3 — le marche vainqueur : apparition, duree de vie, mouvements")
W("")
W("Lignes-instantane a cote vainqueur absente, ecartees des series : **%d / %d** "
  "(%.1f %%)." % (nuls, len(lignes), nuls / len(lignes) * 100))
W("")
W("| operateur | series (operateur x match) | instantanes par serie : median | max |")
W("|---|---|---|---|")
for b in sorted(par_book):
    ss = [v for k, v in series.items() if k[0] == b]
    n = sorted(len(v) for v in ss)
    W("| %s | %d | %d | %d |" % (b, len(ss), statistics.median(n), max(n)))
W("")

W("### Delai entre la premiere apparition et l'heure du match")
W("")
W("| operateur | series | delai median (h) | 1er decile | 9e decile | max |")
W("|---|---|---|---|---|---|")
for b in sorted(par_book):
    dl = []
    for k, v in series.items():
        if k[0] != b:
            continue
        try:
            debut = datetime.datetime.strptime(v[0]["startUtc"].replace("Z", ""), "%Y-%m-%dT%H:%M:%S.%f")
        except ValueError:
            continue
        dl.append((debut - v[0]["_t"]).total_seconds() / 3600.0)
    if not dl:
        continue
    dl.sort()
    W("| %s | %d | %.1f | %.1f | %.1f | %.1f |" % (
        b, len(dl), statistics.median(dl), pct(dl, 10), pct(dl, 90), dl[-1]))
W("")
W("*Le delai est mesure a partir du **premier instantane du depot** (2026-07-31) : "
  "pour un match deja ouvert a cette date, il minore le delai reel. Il est aussi "
  "borne par la cadence de releve (~%.1f h de mediane).*" % statistics.median(gaps))
W("")

W("### Duree de vie d'un prix")
W("")
W("Un « prix » = une valeur de `odd1`. On compte les plages consecutives ou elle "
  "ne bouge pas, en nombre d'instantanes et en heures.")
W("")
W("| operateur | plages de prix | instantanes par plage : moyenne / mediane | heures par plage : mediane | series a prix constant |")
W("|---|---|---|---|---|")
for b in sorted(par_book):
    plages_n, plages_h, constant, total = [], [], 0, 0
    for k, v in series.items():
        if k[0] != b or len(v) < 2:
            continue
        total += 1
        deb = 0
        vals = [r["odd1"] for r in v]
        chg = 0
        for i in range(1, len(v) + 1):
            if i == len(v) or vals[i] != vals[deb]:
                plages_n.append(i - deb)
                plages_h.append((v[i - 1]["_t"] - v[deb]["_t"]).total_seconds() / 3600.0)
                if i < len(v):
                    chg += 1
                deb = i
        if chg == 0:
            constant += 1
    if not plages_n:
        continue
    W("| %s | %d | %.2f / %d | %.2f | %d / %d (%.0f %%) |" % (
        b, len(plages_n), mean(plages_n), statistics.median(plages_n),
        statistics.median(plages_h), constant, total, constant / total * 100))
W("")

W("### Frequence et amplitude des changements de cote")
W("")
W("| operateur | series suivies (>= 2 instantanes) | changements par serie : moyenne | part de series qui bougent | |delta| median | |delta| relatif median | delta max |")
W("|---|---|---|---|---|---|---|")
for b in sorted(par_book):
    nchg, bougent, deltas, rel, tot = [], 0, [], [], 0
    for k, v in series.items():
        if k[0] != b or len(v) < 2:
            continue
        tot += 1
        c = 0
        for i in range(1, len(v)):
            a, z = v[i - 1]["odd1"], v[i]["odd1"]
            if a != z:
                c += 1
                deltas.append(abs(z - a))
                rel.append(abs(z - a) / a)
        nchg.append(c)
        if c:
            bougent += 1
    if not tot:
        continue
    W("| %s | %d | %.2f | %d / %d (%.0f %%) | %s | %s | %s |" % (
        b, tot, mean(nchg), bougent, tot, bougent / tot * 100,
        ("%.3f" % statistics.median(deltas)) if deltas else "-",
        ("%.1f %%" % (statistics.median(rel) * 100)) if rel else "-",
        ("%.3f" % max(deltas)) if deltas else "-"))
W("")

# ------------------------------------------------------------ 4. marche sets
W("## C4 — le marche « nombre de sets »")
W("")
avec = [r for r in lignes if "sets" in r]
W("Present sur **%d / %d** lignes-instantane (%.1f %%), a partir du %s." % (
    len(avec), len(lignes), len(avec) / len(lignes) * 100,
    min(r["_t"] for r in avec).strftime("%Y-%m-%d") if avec else "-"))
W("")
W("| operateur | lignes avec `sets` | series | changements de `odd3` par serie | part qui bougent |")
W("|---|---|---|---|---|")
for b in sorted({r["book"] for r in avec}):
    ss = {}
    for r in avec:
        if r["book"] == b:
            ss.setdefault(r["srId"], []).append(r)
    nchg, bg, tot = [], 0, 0
    for v in ss.values():
        v.sort(key=lambda r: r["_t"])
        if len(v) < 2:
            continue
        tot += 1
        c = sum(1 for i in range(1, len(v))
                if v[i]["sets"].get("odd3") != v[i - 1]["sets"].get("odd3"))
        nchg.append(c)
        bg += 1 if c else 0
    W("| %s | %d | %d | %s | %s |" % (
        b, sum(1 for r in avec if r["book"] == b), len(ss),
        ("%.2f" % mean(nchg)) if nchg else "-",
        ("%d / %d" % (bg, tot)) if tot else "-"))
W("")

# ------------------------------ 5. le prix "ouverture" de l'export = 1er releve ?
W("## C5 — le prix « ouverture » de l'export est-il le premier instantane observe ?")
W("")


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return [t for t in re.findall(r"[a-z]+", s) if len(t) >= 3]


matchs = list(csv.DictReader(open(os.path.join(ROOT, "export", "matches.csv"), encoding="utf-8")))
cotes = list(csv.DictReader(open(os.path.join(ROOT, "export", "cotes.csv"), encoding="utf-8")))
cotes_par = {}
for r in cotes:
    cotes_par.setdefault((r["match_id"], r["book"]), r)
par_date = {}
for m in matchs:
    if m["date"][:4] == "2026":
        par_date.setdefault(m["date"], []).append(m)

apparies, ambigus, sans = 0, 0, 0
ecarts = []
for (book, srid), v in sorted(series.items(), key=lambda kv: (kv[0][0], str(kv[0][1]))):
    r0 = v[0]
    jour = r0["startUtc"][:10]
    cands = []
    t1, t2 = set(norm(r0["p1"])), set(norm(r0["p2"]))
    for dj in (-1, 0, 1):
        d = (datetime.date.fromisoformat(jour) + datetime.timedelta(days=dj)).isoformat()
        for m in par_date.get(d, []):
            if m["discipline"] != r0["discipline"]:
                continue
            a, b = set(norm(m["equipe1"])), set(norm(m["equipe2"]))
            if (t1 & a and t2 & b):
                cands.append((m, False))
            elif (t1 & b and t2 & a):
                cands.append((m, True))
    uniq = {c[0]["match_id"]: c for c in cands}
    if len(uniq) != 1:
        (ambigus if len(uniq) > 1 else sans)
        if len(uniq) > 1:
            ambigus += 1
        else:
            sans += 1
        continue
    m, inverse = list(uniq.values())[0]
    ce = cotes_par.get((m["match_id"], book))
    if not ce:
        sans += 1
        continue
    ouv = tofloat(ce["cote2_ouverture"] if inverse else ce["cote1_ouverture"])
    if ouv is None:
        sans += 1
        continue
    apparies += 1
    ecarts.append({"book": book, "match_id": m["match_id"], "export": ouv,
                   "premier": r0["odd1"], "date": m["date"],
                   "h_avant": None})
W("Fenetre de recouvrement : les relevés commencent le **2026-07-31**, les cotes "
  "de l'export s'arretent au **2026-08-02**. Le chevauchement ne fait donc que "
  "**3 jours de matchs**.")
W("")
W("| resultat de l'appariement | series |")
W("|---|---|")
W("| appariees a un match cote de l'export | %d |" % apparies)
W("| ambigues (plusieurs matchs candidats) | %d |" % ambigus)
W("| sans correspondance (match hors export, ou operateur absent de l'export) | %d |" % sans)
W("")
if ecarts:
    eg = [e["premier"] - e["export"] for e in ecarts]
    ident = sum(1 for x in eg if abs(x) < 1e-9)
    W("| grandeur | valeur |")
    W("|---|---|")
    W("| couples compares | %d |" % len(eg))
    W("| premier releve identique a l'ouverture de l'export | %d (%.0f %%) |" % (
        ident, ident / len(eg) * 100))
    W("| ecart moyen (premier releve - ouverture export) | %+.4f |" % mean(eg))
    W("| ecart median | %+.4f |" % statistics.median(eg))
    W("| ecart absolu median | %.4f |" % statistics.median([abs(x) for x in eg]))
    W("| ecart absolu max | %.4f |" % max(abs(x) for x in eg))
    W("")
    W("Detail des %d couples :" % len(eg))
    W("")
    W("| operateur | date | ouverture export | premier instantane | ecart |")
    W("|---|---|---|---|---|")
    for e in sorted(ecarts, key=lambda e: (e["date"], e["book"]))[:40]:
        W("| %s | %s | %.2f | %.2f | %+.2f |" % (
            e["book"], e["date"], e["export"], e["premier"], e["premier"] - e["export"]))
W("")

path = os.path.join(ROOT, "run4-totaux", "out", "partie-c.md")
open(path, "w", encoding="utf-8").write("\n".join(OUT) + "\n")
print("\n".join(OUT))
