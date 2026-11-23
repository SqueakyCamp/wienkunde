"""Wien Geschichte Wiki (OGD-Layer KULTURWIKIOGD + Wikitext aus cache/wiki/raw_*.json) -> lesbare Kurztexte.
Ausgabe:
  site/data/wiki/b01.json ... b23.json  (Einträge je Bezirk, für die App, nach Bedarf geladen)
  site/data/strassen.json                (Straßennamen mit "benannt nach", für das Quiz)
  cache/wiki/clean.json                  (alles, für die Inhalts-Agenten)
Quelle: Wien Geschichte Wiki, https://www.geschichtewiki.wien.gv.at (Texte gekürzt, Link zum Weiterlesen)."""
import json, pathlib, re, glob, html
from shapely.geometry import shape, Point

R = pathlib.Path(__file__).resolve().parent.parent
D = R / "site/data"; (D / "wiki").mkdir(parents=True, exist_ok=True)
raw = {}
for f in glob.glob(str(R / "cache/wiki/raw_*.json")):
    raw.update(json.load(open(f)))
by_title = {v["title"]: v for v in raw.values()}

bez_shapes = [(b["nr"], shape(b["geom"])) for b in json.load(open(D / "bezirke.json"))]
def bezirk_of(lon, lat):
    pt = Point(lon, lat)
    for nr, s in bez_shapes:
        if s.contains(pt): return nr
    best = min(bez_shapes, key=lambda x: x[1].distance(pt))
    return best[0] if best[1].distance(pt) < 0.01 else None

def strip_templates(t):
    out, depth, i = [], 0, 0
    while i < len(t):
        if t.startswith("{{", i): depth += 1; i += 2; continue
        if t.startswith("}}", i) and depth: depth -= 1; i += 2; continue
        if depth == 0: out.append(t[i])
        i += 1
    return "".join(out)

def clean(t):
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<ref[^>]*/>", "", t); t = re.sub(r"<ref.*?</ref>", "", t, flags=re.S)
    t = strip_templates(t)
    t = re.sub(r"\{\|.*?\|\}", "", t, flags=re.S)                      # Tabellen
    t = re.sub(r"\[\[(Datei|File|Bild|Kategorie|Category):[^\]]*\]\]", "", t, flags=re.I)
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t); t = re.sub(r"\[https?://\S+\]", "", t)
    t = re.sub(r"'''?", "", t); t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    # Literatur-, Quellen-, Weblink-Abschnitte weg
    t = re.split(r"\n=+\s*(Literatur|Quellen?|Weblinks?|Einzelnachweise|Siehe auch|Links)\s*=+", t)[0]
    t = re.sub(r"\n=+\s*([^=\n]+?)\s*=+", r"\n\n\1: ", t)
    t = re.sub(r"\n\*+\s*", "\n• ", t)
    t = re.sub(r"[ \t]+", " ", t); t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def cut(t, n):
    if len(t) <= n: return t
    s = t[:n]; k = max(s.rfind(". "), s.rfind(".\n"))
    return (s[:k + 1] if k > n * 0.5 else s.rstrip() + " …")

feats = json.load(open(R / "cache/ogd/KULTURWIKIOGD.json"))["features"]
nv = lambda v: None if v in (None, "None", "") else v
entries, strassen = [], []
seen = set()
for f in feats:
    p = f["properties"]; pid = str(p["PAGEID"])
    if pid in seen or not f["geometry"]: continue
    seen.add(pid)
    lon, lat = f["geometry"]["coordinates"]
    if not (16.15 < lon < 16.6 and 48.1 < lat < 48.35): continue
    page = raw.get(pid)
    text = ""
    if page:
        w = page["text"]
        m = re.match(r"#(WEITERLEITUNG|REDIRECT)\s*\[\[([^\]|#]+)", w, re.I)
        if m and m.group(2).strip() in by_title: w = by_title[m.group(2).strip()]["text"]
        text = clean(w)
    title = p["SEITENNAME"]
    # Name-Präfix "Titel (Bezirk, Lage), " am Anfang kürzen nicht nötig; Text bleibt so wie im Lexikon
    cat = (p["KATEGORIE_TXT"] or "").lower()
    art = nv(p["ART_DES_OBJEKTS"]) or nv(p["ART_DES_BAUWERKS"]) or nv(p["ART_DER_ORGANISATION"]) or nv(p["ART_DES_EREIGNISSES"])
    e = {"id": int(pid), "n": title, "c": [round(lon, 5), round(lat, 5)], "k": {"topografische_objekte": "topo", "topografischeobjekte": "topo", "bauwerke": "bau", "organisationen": "org", "ereignisse": "ev"}.get(cat, cat),
         "art": art, "b": bezirk_of(lon, lat), "lage": nv(p["LAGE"]), "benannt": nv(p["BENANNT_NACH"]), "frueher": nv(p["FRUEHERE_BEZEICHNUNG"]),
         "von": nv(p["DATUM_VON"]), "bis": nv(p["DATUM_BIS"]), "adr": nv(p["ADRESSE"]), "prom": nv(p["PROMINENTE_PERSONEN"]) or nv(p["PROMINENTE_BEWOHNER"]),
         "full": text}
    entries.append(e)
    if art == "Verkehrsfläche" and e["benannt"]:
        strassen.append({"id": e["id"], "n": title, "c": e["c"], "b": e["b"], "nach": e["benannt"], "seit": nv(p["NAME_SEIT"]), "t": cut(text, 400)})

(R / "cache/wiki/clean.json").write_text(json.dumps(entries, ensure_ascii=False), "utf-8")
for b in range(1, 24):
    items = [{k: v for k, v in dict(e, t=cut(e["full"], 900 if e["art"] != "Verkehrsfläche" else 350)).items() if v is not None and k != "full"} for e in entries if e["b"] == b]
    (D / "wiki" / f"b{b:02d}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), "utf-8")
(D / "strassen.json").write_text(json.dumps(strassen, ensure_ascii=False, separators=(",", ":")), "utf-8")
print(len(entries), "Einträge,", sum(1 for e in entries if e["full"]), "mit Text,", len(strassen), "Straßen mit Namensgeber")
print(sum((D / "wiki" / f"b{b:02d}.json").stat().st_size for b in range(1, 24)) // 1024, "KB Wiki-Dateien")
