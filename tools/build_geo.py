"""Baut die Geodaten für Wienkunde aus Stadt-Wien-OGD (CC BY 4.0) und BEV-Verwaltungsgrenzen (KG).
Ausgabe: site/data/*.json (kompakt, Koordinaten auf 5 Stellen)."""
import json, pathlib, collections, re, math
import shapefile
from pyproj import Transformer
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union, linemerge as _lm
def linemerge(g):
    try: return _lm(g)
    except ValueError: return g

R = pathlib.Path(__file__).resolve().parent.parent
O = R / "cache/ogd"; D = R / "site/data"; D.mkdir(parents=True, exist_ok=True)
load = lambda n: json.load(open(O / f"{n}.json", encoding="utf-8"))["features"]

def rnd(g):
    if isinstance(g, (list, tuple)):
        if g and isinstance(g[0], (int, float)): return [round(g[0], 5), round(g[1], 5)]
        return [rnd(x) for x in g]
    return g
def geo(g, tol):
    s = shape(g).simplify(tol, preserve_topology=True)
    m = mapping(s)
    return {"type": m["type"], "coordinates": rnd(json.loads(json.dumps(m["coordinates"])))}
def save(name, obj):
    (D / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"{name}: {(D / name).stat().st_size // 1024} KB")
def clean(v): return None if v in (None, "None", "", "k.A.", "-") else v

# ---------- Bezirke
bez = []
for f in load("BEZIRKSGRENZEOGD"):
    p = f["properties"]
    bez.append({"nr": int(p["BEZNR"]), "name": p["NAMEK"], "geom": geo(f["geometry"], 3e-5)})
bez.sort(key=lambda b: b["nr"])
save("bezirke.json", bez)
bez_shapes = [(b["nr"], shape(b["geom"])) for b in bez]
def bezirk_of(lon, lat):
    pt = Point(lon, lat)
    for nr, s in bez_shapes:
        if s.contains(pt): return nr
    return None

# ---------- Katastralgemeinden (BEV VGD 1:50 000, EPSG:31287)
tr = Transformer.from_crs(31287, 4326, always_xy=True)
r = shapefile.Reader(str(R / "cache/bev/VGD_50_generalisiert"))
kgs = []
for sr in r.iterShapeRecords():
    rec = sr.record.as_dict()
    if rec["BL_KZ"] != "9": continue
    g = sr.shape.__geo_interface__
    def conv(c):
        if isinstance(c[0], (int, float)): return list(tr.transform(c[0], c[1]))
        return [conv(x) for x in c]
    g = {"type": g["type"], "coordinates": conv(g["coordinates"])}
    s = shape(g); c = s.representative_point()
    kgs.append({"nr": rec["KG_NR"], "name": rec["KG"], "bez": bezirk_of(c.x, c.y), "geom": geo(g, 4e-5)})
kgs.sort(key=lambda k: k["name"])
save("kg.json", kgs)

# ---------- Öffi-Linien: Segmente tragen mehrere Linien ("1, 2, D"); je Linie zusammensetzen
typ_map = {"U-Bahn": "U", "Straßenbahn": "T", "Stadtbus": "B", "Nachtbus": "N", "S-Bahn": "S", "Badner Bahn": "S"}
def inside(g):
    pts = g["coordinates"] if g["type"] == "LineString" else [p for l in g["coordinates"] for p in l]
    return sum(1 for c in pts if 16.18 < c[0] < 16.58 and 48.12 < c[1] < 48.33) > len(pts) / 2
segs = collections.defaultdict(list)
for f in load("OEFFLINIENOGD"):
    p = f["properties"]; t = typ_map.get(p["LTYPTXT"])
    if not t or not f["geometry"] or not inside(f["geometry"]): continue
    for l in [x.strip() for x in p["LBEZEICHNUNG"].split(",")]:
        if t == "B" and not re.fullmatch(r"\d{1,2}[A-Z]", l): continue
        if t == "N" and not re.fullmatch(r"N\d+", l): continue
        segs[(t, l)].append(shape(f["geometry"]))
ub_color = {"U1": "#e3000f", "U2": "#a862a4", "U3": "#eb6a0b", "U4": "#1fa22e", "U6": "#9d6930"}
lines = []
for (t, l), ss in segs.items():
    m = linemerge(unary_union(ss))
    tol = {"U": 4e-5, "S": 6e-5}.get(t, 3e-5)
    g = geo(mapping(m), tol)
    lines.append({"id": l, "t": t, "geom": g, "color": ub_color.get(l)})
order = {"U": 0, "S": 1, "T": 2, "B": 3, "N": 4}
def natkey(x):
    m = re.match(r"([A-Z]*)(\d*)([A-Z]*)", x["id"]); return (order[x["t"]], int(m.group(2) or 0), x["id"])
lines.sort(key=natkey)
save("lines.json", lines)

# ---------- Haltestellen (gleichnamige zusammenfassen, je Linie)
stops = {}
for f in load("OEFFHALTESTOGD"):
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    if not (16.18 < lon < 16.58 and 48.12 < lat < 48.33): continue
    name = re.sub(r"\s+", " ", p["HTXTK"] or p["HTXT"]).strip()
    ls = [x.strip() for x in (p["HLINIEN"] or "").split(",") if x.strip()]
    key = name
    s = stops.setdefault(key, {"n": name, "pts": [], "l": set()})
    s["pts"].append((lon, lat)); s["l"] |= set(ls)
known = {l["id"] for l in lines}
out = []
for s in stops.values():
    ls = sorted(x for x in s["l"] if x in known)
    if not ls: continue
    lon = sum(p[0] for p in s["pts"]) / len(s["pts"]); lat = sum(p[1] for p in s["pts"]) / len(s["pts"])
    out.append({"n": s["n"], "c": [round(lon, 5), round(lat, 5)], "l": ls, "b": bezirk_of(lon, lat)})
save("stops.json", sorted(out, key=lambda x: x["n"]))

# ---------- U-Bahn-Stationen mit Eröffnungsjahr
ust = {}
for f in load("UBAHNHALTOGD"):
    p = f["properties"]; n = p["HTXT"].strip()
    s = ust.setdefault(n, {"n": n, "c": rnd(f["geometry"]["coordinates"]), "l": set(), "y": 9999})
    s["l"].add(f"U{p['LINFO']}")
    if p["EROEFFNUNG_JAHR"]: s["y"] = min(s["y"], int(p["EROEFFNUNG_JAHR"]))
save("ubahn_stationen.json", [{"n": s["n"], "c": s["c"], "l": sorted(s["l"]), "y": None if s["y"] == 9999 else s["y"], "b": bezirk_of(*s["c"])} for s in sorted(ust.values(), key=lambda s: s["n"])])

# ---------- Gewässer (benannte Fließgewässer, je Name zusammengeführt)
riv = collections.defaultdict(list)
for f in load("FLIESSGEWOGD"):
    n = clean(f["properties"]["NAME"])
    if not n or n.lower().startswith("unbenannt"): continue
    riv[n].append(shape(f["geometry"]))
save("gewaesser.json", [{"n": n, "geom": geo(mapping(linemerge(unary_union(ss))), 4e-5)} for n, ss in sorted(riv.items())])
lakes = collections.defaultdict(list)
for f in load("STEHENDEGEWOGD"):
    n = clean(f["properties"]["NAME"])
    if n: lakes[n].append(shape(f["geometry"]))
save("seen.json", [{"n": n, "geom": geo(mapping(unary_union(ss)), 3e-5)} for n, ss in sorted(lakes.items()) if unary_union(ss).area > 2e-6])

# ---------- Märkte
mk = []
for f in load("MAERKTEOGD"):
    p = f["properties"]
    mk.append({"n": p["NAME"], "c": rnd(f["geometry"]["coordinates"]), "kat": clean(p.get("MARKTKATEGORIE")), "url": clean(p.get("URL_MARKTAMT")), "b": bezirk_of(*f["geometry"]["coordinates"])})
save("maerkte.json", mk)

# ---------- Gemeindebauten (alle, mit Baujahr/Wohnungen; benannte Höfe markiert)
gb = []
for f in load("GEMBAUTENFLOGD"):
    p = f["properties"]; s = shape(f["geometry"]); c = s.representative_point()
    name = p["HOFNAME"].strip()
    named = not re.search(r"\d", name)
    gb.append({"n": name.title() if name.isupper() else name, "a": clean(p["ADRESSE"]), "y": int(p["BAUJAHR"]) if clean(p["BAUJAHR"]) and str(p["BAUJAHR"]).isdigit() else None,
               "w": int(p["WOHNUNGSANZAHL"]) if str(p["WOHNUNGSANZAHL"]).isdigit() else None, "b": int(p["BEZIRK"]) if str(p["BEZIRK"]).isdigit() else None,
               "c": [round(c.x, 5), round(c.y, 5)], "named": named, "pdf": clean(p.get("PDFLINK")),
               "geom": geo(f["geometry"], 2e-5) if named else None})
save("gemeindebauten.json", gb)

# ---------- Historisches: Burgen/Schlösser, Synagogen, Wasserleitungen, Befestigung, histor. Gärten, Sehenswürdigkeiten, Friedhöfe, Museen, Brunnen
def pts(name, fields, keep=lambda p: True):
    res = []
    for f in load(name):
        p = f["properties"]
        if not keep(p) or not f["geometry"]: continue
        g = f["geometry"]
        c = g["coordinates"] if g["type"] == "Point" else list(shape(g).representative_point().coords[0])
        item = {k: clean(p.get(v)) for k, v in fields.items()}
        item["c"] = rnd(c); item["b"] = bezirk_of(*c)
        res.append(item)
    return res
hist = {
    "burgen": pts("BURGSCHLOSSOGD", {"n": "NAME", "kat": "KATEGORIE", "txt": "BESCHREIBUNG", "sichtbar": "SICHTBAR"}),
    "synagogen": pts("SYNAGOGENOGD", {"n": "BEZEICHNUNG", "adr": "STANDORT", "bau": "BAUINFO", "arch": "ARCHITEKT", "txt": "BESCHREIBUNG", "url": "LINK2"}),
    "gaerten": pts("HISTGARTENOGD", {"n": "BEZEICHNUNG", "kat": "KATEGORIE", "adr": "ADRESSE_1", "txt": "BESCHREIBUNG"}),
    "sehenswert": pts("SEHENSWUERDIGOGD", {"n": "NAME", "adr": "ADRESSE", "url": "WEITERE_INF"}),
    "friedhoefe": pts("FRIEDHOFOGD", {"n": "NAME", "adr": "ADRESSE"}),
    "museen": pts("MUSEUMOGD", {"n": "NAME", "adr": "ADRESSE", "url": "WEITERE_INF"}),
    "brunnen": pts("MONUMENTALBRUOGD", {"n": "BASIS_NAME", "y": "BAUJAHR", "kuenstler": "KUENSTLER"}),
}
for s in hist["synagogen"]:
    if s["n"]: s["n"] = re.sub(r"\s+", " ", s["n"]).strip()
save("historisch.json", hist)
save("wasserleitungen.json", [{"n": clean(f["properties"]["NAME"]), "verlauf": clean(f["properties"]["VERLAUF"]), "info": clean(f["properties"]["INFO"]), "geom": geo(f["geometry"], 3e-5)} for f in load("HISTWASSERLTGOGD")])
save("befestigung.json", {
    "neuzeit": [{"t": clean(f["properties"].get("ANSPRACHE")), "nr": clean(f["properties"].get("BASTION_NR")), "geom": geo(f["geometry"], 2e-5)} for f in load("STADTBEFESTIGOGD")],
    "mittelalter": [{"t": clean(f["properties"].get("ANSPRACHE")), "abschnitt": clean(f["properties"].get("ABSCHNITT")), "n": clean(f["properties"].get("NAME")), "geom": geo(f["geometry"], 2e-5)} for f in load("MITTELALTBEFESTOGD")],
    "siedlung": [{"t": clean(f["properties"].get("TYP_TEXT")), "txt": clean(f["properties"].get("BESCHREIBUNG")), "geom": geo(f["geometry"], 2e-5)} for f in load("MITTELALTSDLGOGD")],
})

# ---------- Wahlen 2025 je Bezirk (Gemeinderat + Bezirksvertretung), aus Sprengelergebnissen summiert
def wahl(layer):
    agg = collections.defaultdict(lambda: collections.Counter()); names = {}
    for f in load(layer):
        p = f["properties"]; b = int(p["BEZ"])
        agg[b]["_gueltig"] += int(p["GUELTIGESTIMMEN"]); agg[b]["_berechtigt"] += int(p["ANZAHLWAHLBERECHTIGTE"]); agg[b]["_abgegeben"] += int(p["ABGEGEBENESTIMMEN"])
        for k, v in p.items():
            if k.endswith("_STIMMEN") and str(v).lstrip("-").isdigit() and int(v) >= 0:
                key = k[:-8]; agg[b][key] += int(v); names[key] = p.get(key + "_NAMEKURZ") or key
    res = {}
    for b, c in sorted(agg.items()):
        g = c["_gueltig"]
        parts = sorted(((names[k], round(100 * v / g, 1)) for k, v in c.items() if not k.startswith("_") and v > 0), key=lambda x: -x[1])
        res[b] = {"beteiligung": round(100 * c["_abgegeben"] / c["_berechtigt"], 1), "parteien": parts}
    return res
# Bezirksvertretung: Die OGD-Sprengeldaten enthalten keine Wahlkarten (Margareten zeigt dort die SPÖ vorn, tatsächlich gewannen die Grünen).
# Darum die vorläufigen Bezirksergebnisse inkl. Wahlkarten von vienna.at (tools/bv2025_vienna_at.json).
bvx = json.load(open(R / "tools/bv2025_vienna_at.json"))
bv = {int(k): {"beteiligung": None, "parteien": sorted(zip(bvx["_parteien"], v), key=lambda x: -x[1])} for k, v in bvx.items() if not k.startswith("_")}
save("wahl2025.json", {"gr": wahl("WAHLERGEBNISGR251OGD"), "bv": bv, "bv_quelle": bvx["_quelle"]})
