# ADR 0002: Node startet die Plattform; Oliven ist eine optionale Laufzeit

Status: angenommen. Ergänzt ADR 0001, ohne dessen Legacy-Grenze zu ändern.

## Kontext

Der erste Migrationsschritt ließ Python den öffentlichen Node-Server starten.
Dadurch benötigte selbst die allgemeine Homepage Python und die komplette
Oliven-Konfiguration. Diese Kopplung passt nicht zu unabhängigen Projekten.

## Entscheidung

`npm run dev` und `npm start` führen `scripts/server.ts` direkt in Node 24 aus.
Node nutzt die native TypeScript-Unterstützung; `tsc --noEmit` und der Next-Build
prüfen zusätzlich die Typen. Der öffentliche Port wird gebunden, bevor eine
Projektlaufzeit startet. Ein belegter Produktionsport ist ein Startfehler;
Development behält die bisherige Suche nach einem freien Port bei.

Oliven besitzt Konfiguration und Prozessadapter im eigenen `runtime/`-Verzeichnis.
Python läuft ausschließlich im Hintergrund auf Loopback. Eine validierte
Startmeldung teilt Port und Bereitschaft mit; eine getrennte Steuerleitung
ermöglicht normales Beenden und erkennt einen hart beendeten Node-Elternprozess.
Der bestehende Python-Launcher wird zum dünnen Kompatibilitätsadapter, der weder
die Oliven-Anwendung importiert noch eine Datenbank initialisiert.

Der Plattformstart wartet nicht auf das optionale Projekt. Konfigurationsfehler,
fehlendes Python, Zeitüberschreitung und Prozessabsturz lassen die übrige Website
weiterlaufen. Das Projekt liefert 503. Ein Neustart erfolgt bewusst manuell,
damit Initialisierungsfehler keine Schleife mit wiederholten Datenzugriffen auslösen.
Die Ausgabe beschränkt sich auf Lebenszyklus und feste Diagnosemeldungen;
Backend-Tracebacks, Anfragen und Zugangsdaten werden nicht durchgereicht.

Die Health-Endpunkte trennen Plattform und Projekt. Die interne Python-Probe
verwendet keinen fachlichen API-Endpunkt, da diese anonyme Teilnehmer anlegen
können. Ein fehlender Datenbankpfad wird vor dem Legacy-Initialisierer abgewiesen.
Bestehende IDs, Tabellen und Inhalte werden nicht migriert.

## Warum weiterhin ein kleiner eigener Next-Server?

Die ursprüngliche Anwendung erkennt anonyme Teilnehmer anhand der tatsächlichen
Client-IP und des User-Agents. Ein ungeprüfter Forwarding-Header wäre manipulierbar;
ein verlorener Socket-Kontext könnte Teilnehmer im WLAN anders zuordnen.
Der HTTP-Einstieg überschreibt daher alle relevanten Forwarding-Header anhand
von Socket und Host, bevor Next die Anfrage verarbeitet. Das Verhalten ist mit
echten localhost-/Netzwerkanfragen und gefälschten Headern geprüft.

Next empfiehlt eigene Server nur bei Anforderungen, die der integrierte Server
nicht abdeckt ([Next-Dokumentation](https://nextjs.org/docs/app/guides/custom-server)).
Hier hat die bestehende Identitätssemantik Vorrang. Neue Projekte verwenden
trotzdem normale App-Router-Seiten und Route Handler. Der eigene Einstieg bleibt
klein und ersetzt weder Routing noch Rendering des Frameworks.

Folge: Das Deployment benötigt einen Node-Prozess und ist nicht als Next-
`output: 'standalone'` oder reine Serverless-Auslieferung konfiguriert. Ein
späterer Wegfall dieser Grenze braucht einen expliziten Identitätsmigrationsplan.
Python lässt sich nach einer separat abgesicherten Portierung von Oliven entfernen,
ohne den Plattformstart erneut umzubauen.

## Prüfung

Node-Integrationstests starten die fertige Plattform bei deaktiviertem Modul,
fehlendem Interpreter und fehlerhafter Projektkonfiguration. Laufzeittests mit
synthetischer SQLite-Datei prüfen beide Einstiegspunkte, Development/Produktion,
Client-IP, Backend-Ausfall und vollständiges Beenden der Prozessketten.
Die bisherigen Quell-, Daten-, E2E- und pixelgenauen Bildvergleiche bleiben bestehen.
