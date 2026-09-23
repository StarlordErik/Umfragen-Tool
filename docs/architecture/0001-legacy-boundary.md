# ADR 0001: Oliven-Symposium als unverändertes Fachmodul

Status: angenommen. Referenz: `37e8599280f8f911dffe557049859766afd37e9f`.

## Kontext

Die bestehende Anwendung ist ein Python-Standardbibliothek-Server (3.12+), kein
React-Projekt. Etwa 4.000 Zeilen Python enthalten HTML-Erzeugung, PIN-Anmeldung,
SQLite-Zugriffe, Phasensteuerung und fachliche Auswertung. Vier JavaScript-Dateien
steuern Anmeldung/Einreichungen, Fragebögen, Konfiguration und Auswertung. Eine
projektweite CSS-Datei enthält auch ältere überschreibende Regeln. Es gibt keine
extern geladenen Schriftarten, Bilder oder JavaScript-Bibliotheken.

Die SQLite-Datei enthält `respondents`, `survey_responses`, `oils`, `oil_ciphers`,
`oil_owners`, `event_settings` und `sqlite_sequence`. Antworten referenzieren
Teilnehmer-ID, Umfrage-ID und Chiffre. Die drei Phasen regeln Anmeldung,
Einreichungen, Bearbeitung und Auswertung. Die Auswertung umfasst Ranggleichheit,
Verteilungen, Preisfehler, persönliche Ergebnisse, Anonymisierung, Kronen,
Ähnlichkeiten, Eigenöl-Bias und die interaktive dreidimensionale Darstellung.
Diese Semantik bleibt im ursprünglichen Modul.

Weitere Verträge: Name/PIN mit PIN-Datei und Rücksetzung, bestehendes Cookie
`oil_tasting_participant` (Pfad `/`), lokaler Hinweisstatus, Autosave nach 600 ms,
Ergebnisaktualisierung nach 2 s, Abschluss-/Navigationssperren, gemeinsame
Ölbesitzer, Chiffren-Mischung und eigenständiger HTML-Snapshot. Historische
Formularfelder und `/api/config` bleiben aus Kompatibilitätsgründen vorhanden.

## Entscheidung

Ein modularer Monolith mit einem gemeinsamen Start, Repository und Deployment:
Next.js App Router übernimmt Homepage und neue Projekte; ein ausschließlich an
Loopback gebundener Python-Prozess führt das Oliven-Modul aus. Ein serverseitiger
Route Handler transportiert HTML/JSON/Cookies unter `/projects/olive-symposium`.
Das ist eine Übergangsgrenze im selben Deployment, keine Microservice-Plattform.

CSS, Browser-JavaScript, Fragen, Texte und Rechenlogik werden unverändert
verschoben. Ausschließlich echte URL-Attribute und API-Aufrufe werden bei der
Auslieferung mit dem Projektpfad versehen. Übersetzungsschlüssel wie `/` oder
`/ergebnisse` bleiben unverändert. Es gibt weder React-Hydration noch ein neues
Layout um die Legacy-Dokumente. Die Homepage lädt die Legacy-Styles nicht.

Die vorhandene Datenbank behält ihren Pfad. Weder Dateiverschiebung noch
Schemakonvertierung ist für diese Migration erforderlich. Neue Projekte erhalten
`data/projects/<id>.sqlite`. Gemeinsame Datenbankwerkzeuge sind Infrastruktur,
keine gemeinsam genutzten Fachtabellen. Zusätzliche Oliven-Migrationen sind opt-in.

## Folgen und Prüfkriterien

Zwei Laufzeiten sind nötig. Dafür bleiben auch subtile Sonderfälle erhalten.
Strenge TypeScript- und Lint-Regeln gelten für neuen Code, nicht rückwirkend für
das Legacy-Modul. Historische Duplikate in dessen CSS/Rendering bleiben absichtlich
erhalten; ihre Entfernung braucht eine eigene abgesicherte Änderung.

Vor der Verschiebung werden mit synthetischen Daten Playwright-Referenzbilder
erstellt. Dieselben Abläufe laufen anschließend über den neuen Projektpfad.
Zusätzlich werden Originalquellen, Bestandsdaten auf Kopien und komplette
Auswertungspayloads verglichen. Reale Teilnehmerdaten gehören nicht in Screenshots
oder Testartefakte. Ein bestandener Vergleich deckt die getesteten Zustände ab;
er ist kein mathematischer Beweis für alle denkbaren Eingabefolgen.

## Verworfene Alternativen

Eine sofortige React-/ORM-Portierung hätte Formulare, Layout, SQL und Auswertungen
gleichzeitig verändert. Ein iframe würde Navigation, Fokus, Dokumentgröße und
Mobile-Verhalten ändern. Beide Risiken stehen hinter der geforderten Kompatibilität.
