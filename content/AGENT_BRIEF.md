# Auftrag: Inhalte für „Wienkunde“

Wienkunde ist eine private Lern-Web-App für Daniel, der seit über 20 Jahren in Wien lebt. Er will die Stadt besser verstehen, vor allem die Orte, an denen er sich gerade aufhält (die App zeigt ihm unterwegs, was in seiner Nähe ist). **Kein Tourist*innen-Niveau**: Keine Allgemeinplätze wie „Der Stephansdom ist das Wahrzeichen Wiens“. Stattdessen Details, die auch Langzeit-Wiener*innen oft nicht kennen: frühere Nutzungen, verschwundene Gebäude, alte Dorfkerne, eingewölbte Bäche, Herkunft von Namen, Sagen und lokale Mythen, wo was passiert ist (mit Jahr), Architektur und Bauherr*innen, Gemeindebau-Geschichte, Industriegeschichte, NS-Zeit und Erinnerungsorte, aktuelle Stadtentwicklung und Politik, Kurioses.

## Quellen
- Hauptquelle ist dein **Quellenpaket** `cache/packs/bXX.md` (Texte aus dem Wien Geschichte Wiki mit Koordinaten, dazu Katastralgemeinden, Wahl 2025, Märkte, Gemeindebauten). Lies es gründlich (mit Read in Abschnitten; es ist groß).
- Ergänzend dein gesichertes Wissen und die Websuche, vor allem für Aktuelles (Bezirksvorsteher*in nach der Wahl 2025, laufende Stadtentwicklung). **Erfinde nichts.** Wenn du dir bei einer Zahl, einem Jahr oder einem Namen nicht sicher bist, lass sie weg oder prüfe sie per Websuche.
- Jede Angabe braucht mindestens eine Quelle. Für Wien-Geschichte-Wiki-Einträge reicht der exakte Seitentitel im Feld `wiki` (der Link wird automatisch gebaut). Weitere Quellen als `{"t": "Titel", "u": "URL"}`: nur URLs, die es wirklich gibt (de.wikipedia.org-Artikel, wien.gv.at, geschichtewiki, Bezirksmuseen …). Keine geratenen URLs.

## Ausgabe
Schreibe pro Bezirk eine Datei `content/bezirke/bXX.json` (XX zweistellig), UTF-8, gültiges JSON, genau dieses Schema:

```json
{
  "nr": 7,
  "name": "Neubau",
  "kurz": "Ein Satz, der den Bezirk treffend und nicht klischeehaft charakterisiert.",
  "profil": ["Absatz 1", "Absatz 2", "… 5 bis 8 Absätze, je 3–6 Sätze: Entstehung (aus welchen Vorstädten/Vororten/Dörfern, wann eingemeindet, Bezirksgrenzen-Änderungen), Namensherkunft, wichtige Epochen, Sozial- und Baugeschichte, Charakter heute, aktuelle Entwicklungen"],
  "politik": "2–4 Sätze: Bezirksvorsteher*in (Name, Partei, seit wann), Ergebnis der Bezirksvertretungswahl 2025 aus dem Paket, politische Tradition des Bezirks.",
  "quellen": [{"t": "…", "u": "…"}],
  "teile": [
    {"n": "Name des früheren Dorfs / der Vorstadt / Katastralgemeinde / des Grätzels", "art": "Dorf|Vorstadt|Vorort|Katastralgemeinde|Grätzel|Siedlung",
     "wiki": "exakter Wien-Geschichte-Wiki-Titel oder null", "lon": 16.0, "lat": 48.0,
     "text": "3–6 Sätze: Ursprung, erste Erwähnung, alter Ortskern (wo genau, was davon noch zu sehen ist), Eingemeindung, Entwicklung.",
     "quellen": []}
  ],
  "orte": [
    {"n": "Titel", "kat": "geschichte|bauwerk|mythos|ereignis|verschwunden|wasser|wohnen|natur|kultur|alltag|politik|kurios|erinnerung|industrie",
     "wiki": "exakter Wien-Geschichte-Wiki-Titel oder null", "adr": "Adresse oder Lagebeschreibung", "lon": 16.0, "lat": 48.0,
     "jahr": "1683 oder 1890–1904 oder null",
     "text": "3–7 Sätze, konkret und detailreich.",
     "fakt": "Optional ein überraschender Einzeiler oder null",
     "quellen": []}
  ],
  "fragen": [
    {"q": "Frage, die ohne Kontext verständlich ist", "a": "richtige Antwort", "f": ["falsch 1", "falsch 2", "falsch 3"], "erkl": "1–2 Sätze Erklärung", "wiki": "Titel oder null", "quellen": []}
  ]
}
```

Mengen je Bezirk: alle Katastralgemeinden des Bezirks plus wichtige Vorstädte/Grätzel in `teile` (je nach Bezirk 3–20), **25 bis 45 `orte`** (dichte Innenbezirke und der 1. Bezirk eher mehr), **12 bis 20 `fragen`** auf hohem Niveau (Falschantworten plausibel, gleiche Art wie die richtige).

## Koordinaten
`lon`/`lat` in WGS84. Nimm sie aus dem Quellenpaket (Zeile `### Titel | Art | lon,lat`), wenn der Ort dort steht. Sonst schätze sie sorgfältig (Adresse), aber nur, wenn du dir sicher bist, wo der Ort liegt; der Punkt muss im richtigen Bezirk liegen. Lieber `wiki` korrekt setzen: Dann werden die Koordinaten automatisch übernommen.

## Stil
Deutsch, österreichische Begriffe (Jänner, Grätzel, Gemeindebau, Heuriger), ganze Sätze, sachlich und lebendig, keine Werbesprache, keine Emojis, keine Hinweise auf KI. Gendern mit Sternchen wie im Beispiel. Keine Wiederholung derselben Information in mehreren Orten. Schreib für jemanden, der schon dort war und jetzt verstehen will, was er sieht.

Prüfe am Ende die Datei mit `python3 -c "import json;json.load(open('content/bezirke/bXX.json'))"` und melde nur kurz zurück: Datei(en), Anzahl teile/orte/fragen, und welche Angaben du unsicher fandest.
