# Projektraum

Eine Website für unabhängige Projekte. `/` ist die neue Projektübersicht.
Die **Umfrage zum Oliven-Symposium** lebt unter `/projects/olive-symposium` mit
ihrem bisherigen HTML, CSS, JavaScript, Datenformat und Auswertungsverhalten.

## Lokal starten – auch mit dem grünen JetBrains-Pfeil

Voraussetzungen für die Plattform: **Node.js 24 LTS** (ab 24.11) und Git.
Nur das Oliven-Projekt und sein Snapshot benötigen zusätzlich **Python 3.12+**
ohne zusätzliche Pakete. Homepage, neue TypeScript-Projekte, Build und
Plattformtests funktionieren unabhängig von Python.

```powershell
npm.cmd ci
# Nur bei einer neuen Installation: .env.example nach .env kopieren und
# OLIVE_ADMIN_PASSWORD für Oliven setzen. Eine vorhandene .env nicht überschreiben.
npm.cmd run dev
```

In JetBrains weiter **Run 'Umfragen-Tool'** wählen oder den grünen Pfeil neben
`dev` in `package.json` verwenden. Die vorhandene geteilte Run-Konfiguration in
`.idea/runConfigurations/` startet jetzt direkt das npm-Skript mit Node.
Der grüne Run-Pfeil öffnet wie bisher automatisch den Browser.
Node muss als Projektinterpreter eingerichtet sein. `python main.py` bleibt als
Kompatibilitätseinstieg für alte eigene Run-Konfigurationen erhalten: Der Befehl
delegiert an Node und öffnet wie bisher den Browser. Für reguläre Starts ist
Python kein Plattform-Launcher mehr.

Der öffentliche Server bindet standardmäßig an **0.0.0.0**, sucht im Development
ab **8000** einen freien Port und gibt lokale sowie WLAN-Adressen aus. Im
Produktionsmodus wird ein belegter Port mit einem Fehler gemeldet. Geräte im selben WLAN öffnen
die ausgegebene IP-Adresse, beispielsweise `http://192.168.1.20:8000`. Windows muss
Node im privaten Netzwerk zulassen. Die interne Python-Verbindung bleibt auf
`127.0.0.1` und einem automatisch gewählten Port. Node besitzt diesen optionalen
Hintergrundprozess. Eine Steuerleitung sorgt auch beim harten IDE-Stopp unter
Windows dafür, dass kein Python-Server weiterläuft. Beim alten Python-Einstieg
wird auch dessen Node-Kindprozess über eine Steuerleitung beendet.

```powershell
npm.cmd run dev -- --port 8000
npm.cmd run dev -- --open-browser
npm.cmd run build
npm.cmd start
# Nur die Plattform, ohne Oliven/Python (alternativ in .env setzen):
$env:OLIVE_ENABLED = 'false'
npm.cmd run dev
# Anschließend die lokale Umgebungsüberschreibung wieder entfernen:
Remove-Item Env:OLIVE_ENABLED
```

In Shells ohne PowerShell-Ausführungsbeschränkung genügt `npm` statt `npm.cmd`.
Die vorgesehenen Einstiegspunkte sind die npm-Skripte. Ein direktes `next dev`
oder `next start` umgeht die Prozesssteuerung und die vertrauenswürdige Client-IP-
Übergabe für das Oliven-Projekt. Die Gründe für diesen kleinen eigenen
Server-Einstieg stehen in [ADR 0002](docs/architecture/0002-node-runtime.md).

## Konfiguration und Betriebszustand

Node lädt Umgebungsdateien mit `@next/env` nach Next.js-Regeln; bereits gesetzte
Prozessvariablen haben Vorrang. Gemeinsame lokale Einstellungen gehören in `.env`.
Das DB-Werkzeug verwendet dieselbe Reihenfolge. Für produktionsspezifische
`.env.production`-Dateien `NODE_ENV=production` auch beim DB-Aufruf setzen.
Die eigenständigen Python-Kompatibilitätswerkzeuge lesen weiterhin nur `.env`.
Konfiguration wird serverseitig mit Zod geprüft. Keine Projektkonfiguration
wird über `NEXT_PUBLIC_*` veröffentlicht.

| Variable                                 | Wirkung                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`, `PORT`                           | Öffentliche Bind-Adresse und Port; CLI `--host`/`--port` haben Vorrang.                                                         |
| `OLIVE_ENABLED`                          | `true` (Standard) oder `false`; betrifft ausschließlich Oliven.                                                                 |
| `OLIVE_ADMIN_PASSWORD`                   | Bestehendes Admin-Passwort; nur für den Oliven-Start erforderlich.                                                              |
| `OLIVE_DATABASE_PATH`, `OLIVE_PINS_PATH` | Bestehende Projektdateien; historische `UMFRAGEN_*`-Aliase bleiben erhalten.                                                    |
| `OLIVE_PYTHON`                           | Optionaler Interpreterpfad ohne Shell-Argumente; standardmäßig `.venv`, sonst `python` unter Windows bzw. `python3` unter Unix. |
| `OLIVE_STARTUP_TIMEOUT_MS`               | Zeitlimit für die Startmeldung des Hintergrundprozesses, Standard 15000.                                                        |
| `OLIVE_LEGACY_ORIGIN`                    | Nur für Tests/extern verwaltete lokale Backends; ausschließlich `http://127.0.0.1:<port>`. Normalerweise automatisch gesetzt.   |

Fehlendes Python, fehlendes Admin-Passwort, eine ungültige Projektkonfiguration
oder ein abgestürzter Oliven-Prozess blockieren die Homepage nicht. Das Projekt
antwortet dann mit HTTP 503; die Konsole nennt einen bereinigten Fehlergrund.
Nach dessen Behebung die Anwendung neu starten. Es gibt keine automatische
Neustartschleife und keine automatische Ersatzdatenbank bei falschem Dateipfad.

`GET /api/health` prüft die Plattform unabhängig von Projekten. Unter
`GET /api/health/projects/olive-symposium` liefert das Projekt `ok` (200),
`disabled` oder `unavailable` (503). Diese Abfragen erzeugen keine Teilnehmer,
geben keine Daten/Dateipfade aus und werden nicht gecacht. Sie sind eine
Verfügbarkeitsprüfung; die Datenintegrität prüft weiterhin `npm run db -- check`.

## Technologie und Architektur

Neuer Code: Next.js App Router, React Server Components, TypeScript strict,
Zod, CSS Modules, ESLint, Prettier, Vitest/Testing Library und Playwright.
Die Homepage braucht keinen globalen Client-State, keine externen Fonts und
keine UI-Bibliothek. Der Oliven-Kern bleibt Python/SQLite mit eigener Oberfläche.
Node stellt mit `node:sqlite` kleine Werkzeuge für weitere Projektdatenbanken bereit.
Ein ORM oder PostgreSQL bringt für diese Migration keinen Vorteil und wird nicht
zusätzlich eingeführt. Der Datenbankadapter lässt sich später austauschen.

```text
src/
  app/                         Routen, Homepage, Zusammensetzung der Projekte
  projects/
    olive-symposium/
      project.ts               ausschließlich öffentliche Metadaten
      server/                  HTTP- und URL-Adapter
      runtime/                 optionaler Python-Prozess, Konfiguration, Startprotokoll
      data/                    DB-Definition und optionale SQL-Migrationen
      legacy/                  bisherige Anwendung, Texte, Fragen und Assets
  shared/
    projects/                  kleines Metadatenmodell mit Zod
    db/                        Dateiauswahl, Integrität, Backup, Migrationen
    identity/                  stabile globale ID und Teilnehmerreferenz
platform_runtime/              Kompatibilitäts-Imports für alte Python-Werkzeuge
scripts/                       TypeScript-Start, HTTP-Grenze und DB-Werkzeuge
tests/                         ursprüngliche Tests, Quell-/Datenvergleich, E2E
data/umfragen.sqlite3           unverändert übernommene Oliven-Daten
data/projects/<projekt>.sqlite zukünftige Projektdatenbanken
```

Module kommunizieren über kleine öffentliche Einstiegspunkte. Die App setzt sie
zusammen; `shared` importiert keine Projekte. Fachlogik bleibt in ihrem Projekt.
Next-Servermodule werden mit `server-only` geschützt. Die separate Node-Laufzeit
importiert keine React-/Next-Fachmodule und wird nicht in Client-Komponenten
verwendet. Legacy-Seiten werden als
vollständige HTML-Dokumente ausgeliefert, ohne React-Hydration oder Homepage-CSS.

Bestandserhebung, Entscheidung und Konsequenzen:
[ADR 0001](docs/architecture/0001-legacy-boundary.md).

## Oliven-Routen und Kompatibilität

Alle folgenden Pfade liegen unter `/projects/olive-symposium`:

| Pfad                                                       | Funktion                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| leer                                                       | bisherige Symposium-Startseite, Anmeldung, eigene Einreichungen |
| `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` | drei Fragebögen                                                 |
| `/ergebnisse`                                              | gemeinsame Ranglisten                                           |
| `/einzelne-oel-wertungen`                                  | Öl-Details und Dechiffrierung mit Spoiler-Schutz                |
| `/individuelle-ergebnisse`                                 | eigene Ergebnisse                                               |
| `/kompetitive-verkostung`                                  | Minispiel, Kronen und Geschmacksraum                            |
| `/oel-auswahl`                                             | bisherige Konfiguration                                         |

Alte Seitenlinks werden weitergeleitet. Alte `/api/...`- und `/static/...`-Adressen
bleiben für bereits offene Tabs erreichbar. Das Teilnehmer-Cookie behält Name und
Pfad; bestehende Sitzungen, IDs, PINs, Eigentümer und Antworten werden nicht
umgeschrieben. Nur die Wurzeladresse `/` hat ausdrücklich eine neue Aufgabe.

Phasen, Veröffentlichungsregeln, PIN-Rücksetzung, Mehrfachbesitzer, Autosave,
Navigationssperren und Auswertungen bleiben im ursprünglichen Modul. Legacy-
JavaScript und CSS sind nicht Bestandteil neuer Lint-/Format-Regeln. Auch ältere
überschreibende Styles und Renderfunktionen werden nicht ungeprüft entfernt.

## Datenbanken und Migrationen

**`data/umfragen.sqlite3` bleibt am bisherigen Ort**. `OLIVE_DATABASE_PATH`
überschreibt den Pfad; `UMFRAGEN_DB` wird weiterhin unterstützt. Entsprechendes
gilt für `OLIVE_PINS_PATH` und `UMFRAGEN_PINS`. Relative Pfade beziehen sich auf
das Repository. Jedes neue Projekt bekommt standardmäßig eine eigene Datei in
`data/projects/`. Fehlende Datenbanken werden nur ausdrücklich initialisiert.

```powershell
npm.cmd run db -- status olive-symposium
npm.cmd run db -- check olive-symposium
npm.cmd run db -- backup olive-symposium
# Optional, erst wenn die Kontenzuordnung gebraucht wird:
npm.cmd run db -- migrate olive-symposium
npm.cmd run db -- rollback olive-symposium
```

Die Website wendet **keine zusätzliche Migration automatisch** auf die Bestandsdaten
an. Der bisherige idempotente Python-Initialisierer bleibt erhalten. Die optionale
Migration `001-identity-links` ergänzt nur eine Zuordnungstabelle und ist bei der
Auslieferung nicht angewandt. `migrate` und `rollback` erstellen vorher ein geprüftes
SQLite-Backup in `data/backups/`. Migrationen laufen transaktional mit Prüfsummen und
Integritäts-/Fremdschlüsselprüfung. Eine veränderte Migrationshistorie wird abgelehnt.

SQL-Migrationen und synthetische Testdaten werden versioniert. Die vorhandene
Oliven-Datei bleibt gemäß bisheriger Repository-Regel versioniert. Neue produktive
Datenbanken, WAL-Dateien, Backups und Exporte sind standardmäßig ignoriert.
Definierte Datenstände werden durch geprüfte Backups gesichert; das bloße Kopieren
einer laufenden SQLite-Hauptdatei ohne WAL reicht nicht. Für ein Restore Server
stoppen, aktuellen Stand sichern, geprüftes Backup an den konfigurierten Pfad
zurückspielen und `db check` ausführen. Beim Rollback bleiben entfernte Zuordnungen
im vorherigen Backup erhalten.

Globale Accounts, Profile und Legacy-Zuordnung:
[Daten- und Identitätsgrenzen](docs/data-and-identity.md).

## Ein neues Projekt ergänzen

1. `src/projects/<id>/project.ts` mit öffentlichen Metadaten nach `projectSchema`
   anlegen und in `src/app/projects.ts` registrieren.
2. `src/app/projects/<id>/page.tsx` als dünnen Einstieg anlegen. UI, Fachlogik und
   Datenzugriffe im Projekt halten; Unterordner nur für tatsächlich vorhandenen Code.
3. Bei Datenbedarf eine serverseitige DB-Definition `{ id: '<id>' }` und eigene
   SQL-Migrationen erstellen. Die Dateiauswahl ergibt `data/projects/<id>.sqlite`.
   Mit `openProjectDatabase(..., { create: true })` ausdrücklich initialisieren und
   Projekt/Migrationen im DB-CLI registrieren.
4. Eingaben am Server mit Zod prüfen. Nur benötigte Daten ausliefern; Datenbank,
   PIN-Liste und Rohdatenexport gehören niemals nach `public/`.
5. Fachliche Tests und passende E2E-Abläufe hinzufügen. Oliven-Regressionen bleiben
   eine verpflichtende Schranke für gemeinsame Änderungen.

Ein allgemeines Survey-Framework ist bewusst noch nicht implementiert. Gemeinsame
Bausteine können später nach `src/features/surveys/` extrahiert werden, sobald ein
zweites Projekt belastbare Gemeinsamkeiten zeigt. Neue Umfragen müssen das
Oliven-Datenmodell nicht übernehmen.

## Tests

```powershell
npm.cmd exec -- playwright install chromium
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd test
npm.cmd run test:python
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run test:platform
npm.cmd run test:runtime
```

`test:platform` braucht kein Python und prüft nach einem Build den Node-Start bei
deaktiviertem/fehlerhaft konfiguriertem Oliven-Modul, fehlendem Python sowie
fehlendem Admin-Passwort. `test:runtime` ergänzt echte Python-Unterprozesse,
localhost/WLAN, unveränderte anonyme Identität trotz gefälschter Forwarding-Header,
Statusabfragen ohne Datenänderung, Backend-Absturz, fehlende/beschädigte
Datenbanken, Start-Zeitlimits bei einer gesperrten Datenbank und das Beenden
der Prozessketten nach einem harten IDE-Stopp.
Es prüft den direkten Node-Start in Development/Produktion sowie den alten
Python-Einstieg. Alle Starttests verwenden ausschließlich synthetische Daten.

Die vier ursprünglichen Tests sind unverändert erhalten. Weitere Tests vergleichen
Legacy-Funktionen per Python-AST, alle Browser-Assets und Konfigurationen mit dem
Referenzcommit. Bestandsdaten werden nur über eine konsistente SQLite-Kopie geprüft:
logischer Dump vor/nach Initialisierung und alle Ergebnisarten für jeden Teilnehmer.
Die Tests geben keine produktiven Namen oder Antworten aus.

Playwright nutzt synthetische SQLite-Dateien in `.artifacts/e2e/`. Die 30
Referenzbilder decken Desktop (1440×1000) und Mobile (390×844) ab. Der Vergleich
erlaubt **keine abweichenden Pixel**. Geprüft werden Anmeldung, ungültige PIN,
Einreichungen, Speichern, Wiederladen, Netzwerkfehler, Phasen, Schreibschutz,
Ergebnisse, Spoiler-Schutz, Konfiguration und Navigation.

Die Referenz stammt aus `tests/support/reference.json`. `test:reference` exportiert
nur ursprünglichen Code/Assets aus Git, keine privaten Daten. Bei anderer OS- oder
Browser-Version die unveränderte Referenz auf derselben Maschine neu rendern und
anschließend die Migration vergleichen:

```powershell
npm.cmd run test:reference -- --update-snapshots
npm.cmd run test:e2e
# Produktionsprüfung nach npm run build:
$env:E2E_PRODUCTION = '1'
npm.cmd run test:e2e
```

**Nie Oliven-Referenzbilder aus dem migrierten Code übernehmen**, um Fehler zu
kaschieren. CI rendert Original und Migration auf derselben Maschine. Der
Quellvergleich benötigt die Git-Historie (`fetch-depth: 0`). Ergebnisse/Traces
liegen in `test-results/`; Screenshots enthalten ausschließlich Testpersonen.

## Snapshot und Datenschutz

```powershell
python create_snapshot.py
python create_snapshot.py --output exports/momentaufnahme.html --pins-output exports/PINs.txt --db data/umfragen.sqlite3
```

Der eigenständige HTML-Snapshot bleibt verfügbar, schreibgeschützt und mit derselben
PIN-Auswahl. Vorhandene Dateien bleiben lokal erhalten. PIN-Liste und generierte
HTML-Datei werden künftig nicht mehr mit Git erfasst oder als Website-Dateien
ausgeliefert. Der Snapshot enthält weiterhin Umfragedaten im Klartext und gehört
nur an berechtigte Empfänger.

Das lokale Admin-Passwort steht in `.env`; `.env.example` enthält keine Zugangsdaten.
Die Migration hat das bisherige Passwort lokal übernommen. Historische Git-Commits
enthalten weiterhin frühere Daten/Zugangsinformationen; die Historie wurde nicht
umgeschrieben. Das Repository inklusive versionierter Bestands-DB bleibt vertraulich.

Der Adapter begrenzt Anfragen, prüft fremde Browser-Ursprünge, übernimmt die
Client-IP nur aus dem öffentlichen Server-Socket und erlaubt bekannte Routen/Assets.
Teilnehmerdaten werden nicht gecacht. Bestehende PIN-/Admin-Abläufe und die
historische Konfigurations-API bleiben Legacy-Funktionen. Für öffentlichen
Internetbetrieb sind eine gesonderte Authentifizierungs-/Berechtigungs- und
TLS-Umsetzung erforderlich; der voreingestellte Betrieb bleibt lokal im WLAN.
