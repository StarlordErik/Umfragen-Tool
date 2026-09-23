# Daten- und Identitätsgrenzen

## Heute

Das Oliven-Symposium besitzt allein `data/umfragen.sqlite3`. Historische IDs,
PIN-Hashes, Tokens, Zeitstempel, Antworten, Chiffren und Besitzerzuordnungen bleiben
unverändert. Andere Projekte bekommen eigene Dateien. Teilnehmer und Antworten
werden nicht in globale Tabellen übernommen.

`shared/db` bietet Dateiauswahl, Verbindungen, Integritätsprüfungen, konsistente
Backups und transaktionale SQL-Migrationen. Migrationen bleiben bei ihrem Projekt.
Werte werden als gebundene Parameter übergeben. Der CLI-Aufruf verlangt bekannte
Projekte; Dateipfade aus Anfragen werden nicht akzeptiert. Tests initialisieren
zwei getrennte Projektdateien und prüfen ihre Isolation.

`node:sqlite` ist an Node 24 gebunden und in dessen API als experimentell markiert.
Der kleine Adapter kann durch einen anderen Treiber oder Drizzle ersetzt werden,
ohne Fachmodelle oder Legacy-Daten zu ändern. Oliven verwendet im Livebetrieb
weiterhin Pythons SQLite-Treiber. ESLint bleibt auf der mit den aktuellen
Next-/React-Plugins kompatiblen Hauptversion 9; Version 10 wird von diesen Plugins
noch nicht vollständig unterstützt.

## Globale Accounts später

Eine zentrale Identity-Schicht wird Account, Anmeldung und globale Profildaten
verwalten – etwa in `data/global.sqlite`, bei größerem Bedarf in PostgreSQL.
Sie vergibt eine unveränderliche interne `GlobalUserId`. E-Mail, Anzeigename und
die ID eines konkreten OAuth-Anbieters dürfen diesen Schlüssel nicht ersetzen.

Ein Projekt kennt nur seine lokale Teilnehmer-ID und optional diese globale ID.
Anonyme und alte Teilnehmer bleiben gültig. Authentifizierungsdetails werden nicht
in jedes Projekt kopiert. Es gibt keine Fremdschlüssel über Datenbankdateien hinweg;
die Anwendung verifiziert eine globale Identität vor deren Zuordnung.

Die Typgrenze in `shared/identity/contracts.ts` enthält noch keinen Auth-Provider,
keine Sessions und kein fertiges Profilmodell.

## Spätere Zuordnung vorhandener Oliven-Teilnehmer

Die optionale Migration `001-identity-links` erzeugt:

```text
respondents.id (unverändert)
    ↓ legacy_participant_id
legacy_user_mappings
    global_user_id → zentrale Identity
    linked_at, linked_by
```

Ein alter Teilnehmer kann höchstens einer globalen Identität zugeordnet werden;
mehrere alte Teilnehmer können bei begründetem Bedarf demselben Account gehören.
Es erfolgt keine automatische Zuordnung nach Namen oder E-Mail. Die spätere
Anwendung prüft Eigentümerschaft und führt eine nachvollziehbare, explizite
Zuordnung durch. `linked_by` bezeichnet die verifizierende Instanz.
Antworten werden nicht umgeschrieben. Nicht zugeordnete Teilnehmer funktionieren
weiterhin.

Diese Erweiterung wird nicht beim Start aktiviert. Nach späterer Aktivierung
verhindert der Fremdschlüssel das unbemerkte Löschen zugeordneter Teilnehmer.
Deshalb muss vor Aktivierung mit echten Zuordnungen auch der Admin-Löschablauf
um den expliziten Umgang damit ergänzt werden. Rollback/Backup der Erweiterung
verändert keine ursprünglichen Tabellen.

## Persönliche Fragen und Surveys

Globale Profildaten benötigen eigene Zweckbindung, Sichtbarkeit, Versionierung
und Einwilligung. Eine Projektantwort wird nicht allein deshalb global, weil eine
ähnliche Frage in einem zweiten Projekt auftaucht. Eine spätere Vorbefüllung muss
Quelle, Stand und Zustimmung berücksichtigen. Projekte erhalten nur die für
ihren Zweck erforderlichen Angaben.

Ein zukünftiges Survey-Feature kann Survey, Section, Question, Response, Answer
und Evaluation sowie Fragearten modellieren. Es entsteht erst aus konkreten
gemeinsamen Anforderungen. Fragenversion, Antwortschema und Auswertungsregel
müssen dann explizit versioniert werden. React-Widgets und SQLite-Tabellen gehören
nicht in dessen fachlichen Kern. Die heutige Oliven-Auswertung bleibt bis zu einer
getrennt abgesicherten Migration ihre eigene Implementierung.
