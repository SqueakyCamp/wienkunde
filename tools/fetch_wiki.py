"""Holt den Wikitext aller Wien-Geschichte-Wiki-Seiten aus dem OGD-Layer KULTURWIKIOGD (50 Seiten je Anfrage).
Ergebnis: cache/wiki/raw_<n>.json (pageid -> wikitext). Bereits geholte Blöcke werden übersprungen."""
import json, pathlib, time, urllib.request, urllib.parse, sys
R = pathlib.Path(__file__).resolve().parent.parent
feats = json.load(open(R / "cache/ogd/KULTURWIKIOGD.json"))["features"]
ids = sorted({int(f["properties"]["PAGEID"]) for f in feats if f["properties"]["PAGEID"] not in (None, "None")})
out = R / "cache/wiki"; out.mkdir(exist_ok=True)
UA = {"User-Agent": "Wienkunde/1.0 (private Lernapp; einmaliger Abruf, langsam)"}
for i in range(0, len(ids), 50):
    f = out / f"raw_{i // 50:04d}.json"
    if f.exists(): continue
    chunk = ids[i:i + 50]
    q = urllib.parse.urlencode({"action": "query", "pageids": "|".join(map(str, chunk)), "prop": "revisions", "rvprop": "content", "rvslots": "main", "format": "json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request("https://www.geschichtewiki.wien.gv.at/api.php?" + q, headers=UA), timeout=60) as r:
                d = json.load(r); break
        except Exception as e:
            print("retry", i, e, file=sys.stderr); time.sleep(5 * (attempt + 1))
    else:
        continue
    res = {}
    for pid, p in d.get("query", {}).get("pages", {}).items():
        try: res[pid] = {"title": p["title"], "text": p["revisions"][0]["slots"]["main"]["*"]}
        except Exception: pass
    f.write_text(json.dumps(res, ensure_ascii=False))
    print(i // 50, len(res), flush=True)
    time.sleep(1.0)
print("fertig")
