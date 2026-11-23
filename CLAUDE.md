# Wienkunde

Private Lern-App für Daniel: Wien besser kennen (Geografie, Geschichte, Gebäude, Öffis, Politik), unterwegs am Standort oder zu Hause. Nicht Tourist*innen-Niveau, sondern für jemanden, der seit 20 Jahren hier lebt. Jede Information mit Quelle/Link zum Weiterlesen.

- Läuft: `server.py` (stdlib) auf 127.0.0.1:8230, User-Unit `wienkunde.service`. Erreichbar nur über Tailscale Serve **https://debian-server.tail48ed7a.ts.net:8445** (HTTPS ist Pflicht, sonst gibt der Browser den Standort nicht frei). Fortschritt (Lernkartei) in `data/state.json` über `/api/state`, damit Handy und Laptop gleich sind.
- Frontend: `site/` (Vanilla JS + Leaflet, `app.js`, `app.css`), Routen `#/` Karte/Hier, `#/entdecken`, `#/bezirk/N`, `#/thema/K`, `#/stadt/ID`, `#/quiz`, `#/quiz/<modus>`, `#/ich`. Karten: basemap.at grau (Erkunden), Esri World Light Gray Base ohne Beschriftung (Quiz; CARTO braucht inzwischen einen API-Key).

## Daten-Pipeline (in dieser Reihenfolge)
1. `tools/build_geo.py`: Stadt Wien OGD-WFS-Layer aus `cache/ogd/*.json` (Linien, Haltestellen, U-Bahn, Bezirke, Gewässer, Märkte, Gemeindebauten, Burgen/Synagogen/Gärten, Befestigung, Wasserleitungen, Wahl 2025 je Bezirk aus Sprengelergebnissen) und BEV-Verwaltungsgrenzen 1:50 000 (`cache/bev/`, 89 Wiener Katastralgemeinden, EPSG 31287) -> `site/data/*.json`. Öffi-Segmente tragen mehrere Linien ("1, 2, D") und werden je Linie zusammengesetzt; Busse nur `\d{1,2}[A-Z]`, NightLines `N\d+`.
2. `tools/fetch_wiki.py`: Wikitext aller ~15 600 Seiten des OGD-Layers KULTURWIKIOGD (Wien Geschichte Wiki mit Koordinaten) per MediaWiki-API nach `cache/wiki/raw_*.json` (langsam, einmalig).
3. `tools/build_wiki.py`: Wikitext säubern -> `site/data/wiki/bXX.json` (je Bezirk, Text gekürzt, Link per curid) und `site/data/strassen.json` (Straßennamen mit „benannt nach“ fürs Quiz), `cache/wiki/clean.json`.
4. `tools/make_packs.py`: Quellenpakete je Bezirk für die Inhalts-Agenten (`cache/packs/bXX.md`).
5. Inhalte: `content/bezirke/bXX.json` (Porträt, Politik, `teile` = alte Dörfer/Vorstädte/Grätzel, `orte` = Geschichten, `fragen`) und `content/stadt.json` (gesamtstädtische Themen, Fakten je Öffi-Linie, Fragen). Geschrieben von Sonnet-Agenten nach `content/AGENT_BRIEF.md` aus dem Wiki-Paket + Websuche.
6. `tools/build_content.py`: führt alles zu `site/data/content.json` zusammen, setzt Wiki-curid und Koordinaten aus dem Wiki-Titel, verwirft Punkte außerhalb des Bezirks, prüft Wikipedia-Links über die API. Hinweise in `content/report.txt`.

## Regeln
- Keine erfundenen Fakten oder URLs; Wiki-Titel müssen im Layer existieren. Texte sind KI-Zusammenfassungen der Quellen, die Links führen zu den Quellen (die App sagt das unter Entdecken > Daten und Quellen).
- Quiz: Lernkartei mit Boxen 0–5 (`IVL` Tage), Runden à 10, Umfang ganz Wien / in meiner Nähe / Bezirk. Neue Modi in `MODES` (items + ask-Funktion).
- Wien-Geschichte-Wiki-Texte nur gekürzt und mit Link zeigen; die App bleibt privat (Tailscale).

## Hinweise (23.11.2026)
- Wahl 2025: Gemeinderat aus OGD-Sprengeldaten (stimmt mit dem Endergebnis überein). Die OGD-Sprengeldaten der **Bezirksvertretungswahl enthalten keine Wahlkarten** (Margareten wäre dort falsch) -> BV-Werte aus `tools/bv2025_vienna_at.json` (vienna.at, vorläufig inkl. Großteil der Wahlkarten). `build_content.py` streicht Prozent-Sätze aus den Politiktexten der Agenten.
- Bezirksvorsteher*innen sind gegen https://www.wien.gv.at/<slug>/bezirksvorstehung geprüft (Seitentitel nennt den Namen); die App verlinkt diese Seite je Bezirk.
- Server liefert .json/.js/.css gzip-komprimiert (Cache in `data/gz/`); Daten werden mit `cache: "no-cache"` geladen.
- Straßennamen-Quiz nur für Straßen, deren Name den Namensgeber nicht verrät (`nonTrivialStreet`).
- Laut OGD-Liniennetz (Stand 11/2026) fährt der D-Wagen bis Simmering (Enkplatz); Linie 33 ist eingestellt.
