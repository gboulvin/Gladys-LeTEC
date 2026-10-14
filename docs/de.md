# TEC — Busse, Trams und Metro der Wallonie

Diese Integration zeigt in Gladys die **nächsten Abfahrten** der TEC-Busse,
der Tram von Lüttich und der Metro von Charleroi an, mit **Verspätungen**,
**Ausfällen** und **Störungen** (Bauarbeiten, Umleitungen, Streiks) in
Echtzeit.

## Was Sie erhalten

Ein Gerät pro überwachter Haltestelle, mit:

| Funktion                        | Beispiel                                                |
| ------------------------------- | ------------------------------------------------------- |
| Nächste Abfahrt                 | `8` Minuten                                             |
| Nächste Fahrt                   | `M2 → ANDERLUES Monument · 08:03 (+3 Min.)`             |
| Verspätung der nächsten Abfahrt | `3` Minuten                                             |
| Übernächste Abfahrt             | `22` Minuten                                            |
| Nächste Abfahrten               | `M2 8 Min. (+3 Min.) · 52 08:05 fällt aus · M4 25 Min.` |
| Störungen                       | `1` (aktuelle Meldungen auf den Linien)                 |

Nachts zählt „Nächste Abfahrt" die Minuten bis zur ersten Abfahrt am Morgen.

## Konfiguration

1. **API-Schlüssel (optional, empfohlen).** Die Verspätungen stammen vom
   Open-Data-Portal [Belgian Mobility](https://data.belgianmobility.io). Ohne
   Schlüssel akzeptiert es nur 100 Anfragen pro Tag: Die Echtzeitdaten werden
   dann alle 20 Minuten aktualisiert. Mit einem kostenlosen Schlüssel jede
   Minute:
   - erstellen Sie ein Konto im
     [Entwicklerportal](https://api-management-opendata-production.developer.azure-api.net/signup);
   - abonnieren Sie das kostenlose Produkt (Standard);
   - kopieren Sie den **Primärschlüssel** Ihres Abonnements in das Feld
     „API-Schlüssel".
2. **Finden Sie Ihre Haltestellen.** Jede Haltestelle hat **einen Code pro
   Fahrtrichtung** (z. B. `CMpa1` und `CMpa2` für die beiden Bahnsteige der
   Metrostation Palais). Zwei Schaltflächen helfen:
   - **Haltestelle suchen**: Geben Sie einen Teil des Namens ein („charleroi
     gare"), die Codes werden mit den bedienenden Linien aufgelistet;
   - **Haltestellen in meiner Nähe**: die Haltestellen, die Ihren
     Gladys-Häusern am nächsten liegen (der Standort des Hauses muss
     eingetragen sein).
     Das erste Laden des Fahrplans dauert ein bis zwei Minuten.
3. **Haltestellen**: Listen Sie die Codes durch Kommas getrennt auf. Um nur
   bestimmte Linien einer Haltestelle zu behalten, fügen Sie sie nach einem
   Doppelpunkt hinzu, getrennt durch `+`: `CMpa1:M2+M4, Ctrrpla2:82`.
   Höchstens zwanzig Haltestellen.
4. Speichern Sie und fügen Sie die Geräte im Tab **Entdecken** hinzu.

Weitere Einstellungen:

- **Sprache der Texte**: Sprache der Gerätenamen und der in den Zuständen
  geschriebenen Texte.
- **Echtzeit-Aktualisierung**: mit Schlüssel, wie oft der Echtzeit-Feed
  gelesen wird (standardmäßig 60 s).
- **Angezeigte Abfahrten**: wie weit die Listen vorausschauen (standardmäßig
  90 Minuten).
- **Verspätungsalarm ab**: die Verspätung, die „TEC-Abfahrt verspätet"
  auslöst (standardmäßig 5 Minuten).

## Aktionen

- **Haltestelle suchen** und **Haltestellen in meiner Nähe** — siehe oben.
- **Verbindung testen** — liest den Echtzeit-Feed live und zeigt die
  Fahrplanversion, die verfolgten Fahrten und die verbrauchten Anfragen.
- **Fahrplan jetzt aktualisieren** — TEC veröffentlicht jede Nacht einen
  neuen Fahrplan; die Integration prüft selbst alle 6 Stunden.

## Szenen

Auslöser (Kategorie **Integrationen** des Szeneneditors):

- **TEC-Abfahrt bald** — eine Abfahrt in N Minuten. Wählen Sie Haltestelle,
  Linie und einen oder mehrere Werte für N (1 bis 30 Minuten).
- **TEC-Abfahrt verspätet** — eine Abfahrt innerhalb der Stunde hat
  mindestens die eingestellte Verspätung.
- **TEC-Abfahrt fällt aus** — eine Abfahrt innerhalb der Stunde fällt aus
  oder hält nicht mehr an der Haltestelle.
- **Neue TEC-Störung** — eine neue Meldung betrifft eine Linie einer
  überwachten Haltestelle.

Die folgenden Aktionen lesen die Details, z. B.
`{{triggerEvent.data.line}}`, `{{triggerEvent.data.destination}}`,
`{{triggerEvent.data.expected_time}}` oder `{{triggerEvent.data.title}}`.

Aktionen:

- **Nächste TEC-Abfahrt abrufen** — Linie, Ziel, Minuten, erwartete Zeit,
  Verspätung und eine Zusammenfassung, für eine Nachricht.
- **TEC-Linie prüfen** — ob eine Linie gestört ist, mit der Anzahl der
  Meldungen und ihrer Zusammenfassung.

## Widgets

- **TEC-Abfahrten** — die Abfahrtstafel einer Haltestelle: nächste Abfahrt,
  Verspätung und Störungen live, die nächsten Abfahrten nach Verspätung
  eingefärbt, Datenquelle und Schaltfläche „Aktualisieren".
- **TEC-Störungen** — die aktuellen Meldungen auf den Linien Ihrer
  Haltestellen, mit Link zu den Details auf letec.be.

## Daten und Datenschutz

- Fahrplan: Open Data des TEC (CC0), von `opendata.tec-wl.be` heruntergeladen
  (ca. 80 MB) und lokal in `/data` indiziert.
- Echtzeit: Open-Data-Portal Belgian Mobility (CC BY 4.0) — „Quelle: LETEC –
  Open Data".
- Der Standort Ihrer Häuser wird nur von der Schaltfläche „Haltestellen in
  meiner Nähe" gelesen und verlässt Ihr Gladys nie.

## Fehlerbehebung

- **„Ignoriert (unbekannte Haltestelle…)"**: Der Code steht nicht im
  Fahrplan; nutzen Sie die Haltestellensuche (Groß-/Kleinschreibung beachten).
- **Oranges Cloud-Abzeichen**: kein API-Schlüssel (Echtzeit alle 20 Minuten)
  oder Echtzeit vorübergehend nicht verfügbar; die Fahrplanzeiten bleiben
  sichtbar.
