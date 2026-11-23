"""content/bezirke/bXX.json + content/stadt.json -> site/data/content.json
Prüft: Wien-Geschichte-Wiki-Titel (-> curid, Koordinaten), Punkt im richtigen Bezirk, Wikipedia-Links (API), Pflichtfelder.
Probleme landen in content/report.txt."""
import json, pathlib, re, glob, urllib.request, urllib.parse, unicodedata
from shapely.geometry import shape, Point

R = pathlib.Path(__file__).resolve().parent.parent
D = R / "site/data"
wiki = json.load(open(R / "cache/wiki/clean.json"))
by_title = {}
for e in wiki: by_title.setdefault(e["n"], e)
low = {k.lower(): v for k, v in by_title.items()}
bez = {b["nr"]: shape(b["geom"]) for b in json.load(open(D / "bezirke.json"))}
report = []
UA = {"User-Agent": "Wienkunde/1.0 (private Lernapp)"}

def slug(s):
    s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:50]

def find_wiki(t):
    if not t: return None
    return by_title.get(t) or low.get(t.lower()) or low.get(re.sub(r"\s*\(.*\)$", "", t).lower())

wp_titles = set()
def collect_wp(q):
    for x in q or []:
        u = x.get("u", "")
        m = re.match(r"https?://de\.wikipedia\.org/wiki/(.+)", u)
        if m: wp_titles.add(urllib.parse.unquote(m.group(1)).replace("_", " ").split("#")[0])

_gw_cache = {}
def gw_exists(t):
    """Seite ohne Koordinaten: direkt beim Wien Geschichte Wiki nachsehen (inkl. Weiterleitungen)."""
    if t in _gw_cache: return _gw_cache[t]
    q = urllib.parse.urlencode({"action": "query", "titles": t, "redirects": 1, "format": "json"})
    try:
        with urllib.request.urlopen(urllib.request.Request("https://www.geschichtewiki.wien.gv.at/api.php?" + q, headers=UA), timeout=20) as r:
            pages = json.load(r)["query"]["pages"]
        p = next(iter(pages.values()))
        _gw_cache[t] = None if "missing" in p or "invalid" in p else (p["pageid"], p["title"])
    except Exception:
        _gw_cache[t] = None
    return _gw_cache[t]

def fix(o, b, kind, label):
    w = find_wiki(o.get("wiki"))
    if o.get("wiki") and not w:
        g = gw_exists(o["wiki"])
        if g: o["wiki_id"], o["wiki"] = g
        else: report.append(f"{label}: Wiki-Titel nicht gefunden: {o['wiki']}"); o["wiki"] = None
    if w:
        o["wiki_id"] = w["id"]; o["wiki"] = w["n"]
    c = None
    if o.get("lon") and o.get("lat"):
        c = [round(float(o["lon"]), 5), round(float(o["lat"]), 5)]
    if w and (not c or (b and not bez[b].buffer(0.003).contains(Point(*c)))):
        c = w["c"]
    if c and b and not bez[b].buffer(0.004).contains(Point(*c)):
        report.append(f"{label}: Punkt liegt nicht im {b}. Bezirk ({c}) -> ohne Kartenpunkt")
        c = None
    if c and not (16.15 < c[0] < 16.6 and 48.1 < c[1] < 48.35): c = None
    o["c"] = c
    for k in ("lon", "lat"): o.pop(k, None)
    o["b"] = b
    collect_wp(o.get("quellen"))
    return o

BV_SLUG = dict(enumerate("innerestadt leopoldstadt landstrasse wieden margareten mariahilf neubau josefstadt alsergrund favoriten simmering meidling hietzing penzing rudolfsheim-fuenfhaus ottakring hernals waehring doebling brigittenau floridsdorf donaustadt liesing".split(), 1))
out = {"bezirke": {}, "orte": [], "teile": [], "fragen": [], "stadt": [], "linien": {}}
ids = set()
def uid(base):
    i, u = 1, base
    while u in ids: i += 1; u = f"{base}-{i}"
    ids.add(u); return u

for f in sorted(glob.glob(str(R / "content/bezirke/b*.json"))):
    try: d = json.load(open(f))
    except Exception as e: report.append(f"{f}: kein gültiges JSON: {e}"); continue
    b = int(d["nr"])
    collect_wp(d.get("quellen"))
    # Wahlprozente aus dem Quellenpaket stammen aus den OGD-Sprengeldaten (BV ohne Wahlkarten) -> Sätze mit Prozentangaben weglassen,
    # die App zeigt die geprüften Ergebnisse direkt darunter.
    if d.get("politik"):
        sents = re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ])", d["politik"])
        d["politik"] = " ".join(x for x in sents if not re.search(r"\d+[,.]\d+\s*(Prozent|%)|Prozent|Beteiligung", x))
    out["bezirke"][b] = {k: d.get(k) for k in ("name", "kurz", "profil", "politik", "quellen")}
    out["bezirke"][b]["bv_url"] = f"https://www.wien.gv.at/{BV_SLUG[b]}/bezirksvorstehung"
    for t in d.get("teile", []):
        t = fix(t, b, "teil", f"b{b} Teil {t.get('n')}"); t["id"] = uid(f"t{b}-{slug(t['n'])}"); out["teile"].append(t)
    for o in d.get("orte", []):
        if not o.get("text"): continue
        o = fix(o, b, "ort", f"b{b} Ort {o.get('n')}"); o["id"] = uid(f"o{b}-{slug(o['n'])}"); out["orte"].append(o)
    for q in d.get("fragen", []):
        if not (q.get("q") and q.get("a") and len(q.get("f", [])) >= 3): report.append(f"b{b} Frage unvollständig: {q.get('q')}"); continue
        w = find_wiki(q.get("wiki"))
        q["wiki_id"] = w["id"] if w else None
        if w: q["wiki"] = w["n"]; q["c"] = w["c"] if bez[b].buffer(0.003).contains(Point(*w["c"])) else None
        q["b"] = b; q["id"] = uid(f"q{b}-{slug(q['q'])[:30]}"); collect_wp(q.get("quellen")); out["fragen"].append(q)

sf = R / "content/stadt.json"
if sf.exists():
    try:
        s = json.load(open(sf))
        for t in s.get("stadt", []):
            collect_wp(t.get("quellen"))
            t["orte"] = [fix(o, None, "ort", f"Stadt {t['n']} / {o.get('n')}") for o in t.get("orte", []) if o.get("text")]
            for o in t["orte"]:
                o["id"] = uid(f"s-{slug(o['n'])}")
                if o["c"]:
                    nr = next((n for n, g in bez.items() if g.contains(Point(*o["c"]))), None); o["b"] = nr
            out["stadt"].append(t)
        out["linien"] = s.get("linien", {})
        for v in out["linien"].values(): collect_wp(v.get("quellen"))
        for q in s.get("fragen", []):
            if not (q.get("q") and q.get("a") and len(q.get("f", [])) >= 3): continue
            w = find_wiki(q.get("wiki")); q["wiki_id"] = w["id"] if w else None
            if w: q["wiki"] = w["n"]
            q["b"] = None; q["id"] = uid(f"qs-{slug(q['q'])[:30]}"); collect_wp(q.get("quellen")); out["fragen"].append(q)
    except Exception as e: report.append(f"stadt.json: {e}")

# Wikipedia-Links prüfen (50 je Anfrage); fehlende entfernen
exists = set()
tl = sorted(wp_titles)
for i in range(0, len(tl), 50):
    q = urllib.parse.urlencode({"action": "query", "titles": "|".join(tl[i:i + 50]), "redirects": 1, "format": "json"})
    try:
        with urllib.request.urlopen(urllib.request.Request("https://de.wikipedia.org/w/api.php?" + q, headers=UA), timeout=30) as r:
            d = json.load(r)["query"]
        norm = {x["from"]: x["to"] for x in d.get("normalized", [])}
        redir = {x["from"]: x["to"] for x in d.get("redirects", [])}
        ok = {p["title"] for p in d["pages"].values() if "missing" not in p and "invalid" not in p}
        for t in tl[i:i + 50]:
            t2 = norm.get(t, t); t3 = redir.get(t2, t2)
            if t3 in ok or t2 in ok: exists.add(t)
    except Exception as e:
        report.append(f"Wikipedia-Prüfung fehlgeschlagen: {e}"); exists |= set(tl[i:i + 50])
def prune(q, label):
    keep = []
    for x in q or []:
        u = x.get("u", "")
        m = re.match(r"https?://de\.wikipedia\.org/wiki/(.+)", u)
        if m and urllib.parse.unquote(m.group(1)).replace("_", " ").split("#")[0] not in exists:
            report.append(f"{label}: Wikipedia-Artikel gibt es nicht: {u}"); continue
        if not u.startswith("http"): continue
        keep.append(x)
    return keep
for b, p in out["bezirke"].items(): p["quellen"] = prune(p.get("quellen"), f"b{b}")
for o in out["orte"] + out["teile"] + out["fragen"]: o["quellen"] = prune(o.get("quellen"), o["id"])
for t in out["stadt"]:
    t["quellen"] = prune(t.get("quellen"), t["id"])
    for o in t["orte"]: o["quellen"] = prune(o.get("quellen"), o["id"])
for k, v in out["linien"].items(): v["quellen"] = prune(v.get("quellen"), "Linie " + k)

nosrc = [o["id"] for o in out["orte"] + out["teile"] if not o.get("wiki_id") and not o.get("quellen")]
report.append(f"Ohne jede Quelle: {len(nosrc)} {nosrc[:30]}")
(D / "content.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
(R / "content/report.txt").write_text("\n".join(report), "utf-8")
print(f"Bezirke {len(out['bezirke'])}, Orte {len(out['orte'])} (mit Punkt {sum(1 for o in out['orte'] if o['c'])}), Teile {len(out['teile'])}, Fragen {len(out['fragen'])}, Stadt-Themen {len(out['stadt'])}, Linien {len(out['linien'])}")
print(f"{len(report)} Hinweise in content/report.txt")
