"""Quellenpakete je Bezirk für die Inhalts-Agenten: cache/packs/bXX.md
Enthält die Wien-Geschichte-Wiki-Texte (ohne Straßen), die Katastralgemeinden, Wahl 2025, Märkte, benannte Gemeindebauten."""
import json, pathlib
R = pathlib.Path(__file__).resolve().parent.parent
D = R / "site/data"; P = R / "cache/packs"; P.mkdir(parents=True, exist_ok=True)
entries = json.load(open(R / "cache/wiki/clean.json"))
bez = {b["nr"]: b["name"] for b in json.load(open(D / "bezirke.json"))}
kg = json.load(open(D / "kg.json"))
wahl = json.load(open(D / "wahl2025.json"))
mk = json.load(open(D / "maerkte.json"))
gb = json.load(open(D / "gemeindebauten.json"))
hist = json.load(open(D / "historisch.json"))
prio = {"Katastralgemeinde": 0, "Bezirk": 0, "Vorstadt": 0, "Vorort": 0, "Ort": 0, "Grätzel": 1, "Siedlung": 1, "Herrschaft": 1, "Markt": 1, "Gewässer": 1, "Berg": 1, "Werd": 1, "Park": 2, "Friedhof": 2, "Sakralbau": 2, "Denkmal": 3, "Brücke": 3, "Gebäude": 4}
for b, name in bez.items():
    es = [e for e in entries if e["b"] == b and e["art"] != "Verkehrsfläche" and e["full"] and len(e["full"]) > 120]
    es.sort(key=lambda e: (prio.get(e["art"], 5), -len(e["full"])))
    out = [f"# Quellenpaket {b}. Bezirk {name}\n",
           "Katastralgemeinden (BEV): " + ", ".join(k["name"] for k in kg if k["bez"] == b),
           f"Gemeinderatswahl 2025 im Bezirk (Stadt Wien OGD): Beteiligung {wahl['gr'][str(b)]['beteiligung']} %, " + ", ".join(f"{p} {v} %" for p, v in wahl["gr"][str(b)]["parteien"][:7]),
           f"Bezirksvertretungswahl 2025: Beteiligung {wahl['bv'][str(b)]['beteiligung']} %, " + ", ".join(f"{p} {v} %" for p, v in wahl["bv"][str(b)]["parteien"][:7]),
           "Märkte: " + ", ".join(m["n"] for m in mk if m["b"] == b),
           "Benannte Gemeindebauten (Name, Baujahr, Wohnungen): " + "; ".join(f"{g['n']} ({g['y']}, {g['w']})" for g in sorted([g for g in gb if g["b"] == b and g["named"]], key=lambda g: -(g["w"] or 0))[:40]),
           "Burgen/Schlösser (Stadtarchäologie): " + " | ".join(f"{h['n']}: {h['txt']}" for h in hist["burgen"] if h["b"] == b),
           "Historische Synagogen: " + " | ".join(f"{h['adr']}: {h['txt']}" for h in hist["synagogen"] if h["b"] == b),
           "\n## Wien Geschichte Wiki (Titel | Art | Koordinaten lon,lat | Text)\n"]
    total = sum(len(x) for x in out)
    for e in es:
        t = e["full"][:2500]
        block = f"### {e['n']} | {e['art'] or e['k']} | {e['c'][0]},{e['c'][1]}\n{t}\n"
        if total + len(block) > 260_000: break
        out.append(block); total += len(block)
    (P / f"b{b:02d}.md").write_text("\n".join(out), "utf-8")
    print(b, name, len(es), total // 1000, "k")
