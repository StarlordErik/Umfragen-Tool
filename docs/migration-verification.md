# Prüfung der Migration

Referenz: `37e8599280f8f911dffe557049859766afd37e9f` vor der Migration.
Lokal geprüft unter Windows mit Node 24.19, Python 3.14 und dem durch
Playwright 1.63 bereitgestellten Chromium.

## Bestand bei der ersten Migration erhalten

- Die vorhandene SQLite-Datei wurde nicht verschoben oder migriert.
- SHA-256 vor und nach der Arbeit:
  `80770e69b5cc3783c92d026914afe705ccd35ef4cd85c317282593f17e04409f`.
- Ausgangsbestand: 16 Teilnehmer, 494 Antworten, 24 Öl-Slots, 72 Chiffren,
  14 Besitzerzuordnungen, zwei Veranstaltungseinstellungen.
- Vollständiger logischer Datenbank-Dump auf einer konsistenten Kopie ist vor und
  nach der Initialisierung identisch; Integrität und Fremdschlüssel sind gültig.
- Gemeinsame, persönliche und kompetitive Ergebnis-Payloads stimmen für alle
  vorhandenen Teilnehmer sowie den anonymen Aufruf mit der Referenz überein.
- Alle Python-Fachfunktionen und HTTP-Handler sind per AST identisch. Ausgenommen
  ist nur die dokumentierte Konfiguration des Admin-Passworts. Dateikonstanten
  zeigen auf den neuen Modulort. Browser-Assets, Fragen und Texte sind identisch.
- Die vier ursprünglichen Tests blieben unverändert erhalten.

## Prüfungen der ersten Migration

| Prüfung                                        | Ergebnis                               |
| ---------------------------------------------- | -------------------------------------- |
| Produktionsbuild                               | erfolgreich                            |
| TypeScript strict                              | erfolgreich                            |
| ESLint                                         | erfolgreich                            |
| Vitest / Testing Library                       | 12 Tests erfolgreich                   |
| Python / SQLite / Quellvergleich               | 7 Tests erfolgreich                    |
| Originalanwendung mit erweiterten E2E-Abläufen | 6 Tests erfolgreich                    |
| Migrierte Anwendung im Produktionsmodus        | 10 E2E-Tests erfolgreich               |
| Desktop-/Mobilbilder                           | 30 Vergleiche, null abweichende Pixel  |
| Gemeinsamer Launcher / lokale Netzwerkadresse  | erfolgreich                            |
| Direkte Beendigung des Launcher-Prozesses      | Node und Python beendet                |
| Historischer Snapshot-CLI mit Testdaten        | HTML und PIN-Datei erfolgreich erzeugt |
| Prüfung produktiver npm-Abhängigkeiten         | keine gemeldeten Schwachstellen        |

Die Browserabläufe umfassen falsche PIN, Anmeldung/Abmeldung, Phasensperren,
erfolgreiche gemeinsame Einreichung und Wiederaufruf, alle drei Fragebögen,
Autosave und Wiederladen, Netzwerkfehler mit anschließendem Speichern,
Navigationssperren, Schreibschutz, alle vier Ergebnisseiten, Spoiler-Schutz,
Admin-Anmeldung und Abbruch einer Phasenänderung. Plattformtests prüfen
Tastaturzugang, mobile Breite, Projektlink, Styles-Isolation, alte Adressen,
private Dateipfade, fremde Ursprünge, ungültiges JSON und die Größenbegrenzung.

## Zweiter Schritt: Entkopplung des Starts

Der Start erfolgt nun direkt in TypeScript/Node. Python ist ein optionaler
Unterprozess des Oliven-Projekts. Der Legacy-Kern, seine Assets, Fragen,
Auswertungen, Cookies und bestehenden Datensätze wurden dafür nicht verändert.

Die Bestandsdaten wurden zwischen den Arbeitsschritten weitergenutzt. Ihr
SHA-256 zu Beginn und nach der Entkopplung ist identisch:
`28fd7c03c9a94f1c8fe7388191b458a6af40c5fdaa41b4055aa2d3802f3c0d76`.
Der frühere Datenstand wurde ausdrücklich nicht wiederhergestellt.
Die vorhandenen lokalen Oliven-Einstellungen werden vom bisherigen Python-
Parser und vom neuen Node-Start gleich gelesen; Zugangsdaten wurden dabei
weder ausgegeben noch geändert.

Zusätzliche Prüfungen unter Windows:

- 29 Vitest-Tests für Datenbanken, Oberfläche, Proxy, Health-Endpunkt,
  Konfiguration, Forwarding-Header und Portauswahl.
- Vier echte Node-Starts ohne funktionierenden Python-Interpreter:
  deaktiviertes Projekt, fehlendes Python, fehlendes Admin-Passwort,
  ungültige Projektkonfiguration. Homepage bleibt 200, Projekt liefert 503.
- Sieben Laufzeitfälle mit synthetischen Daten: Node in Produktion,
  Python-Kompatibilitätseinstieg, Backend-Absturz, fehlende/beschädigte/gesperrte
  Datenbank und Node in Development mit voreingestelltem Interpreter.
- localhost und lokale Netzwerkadresse, anonyme Identität bei gefälschten
  Forwarding-Headern, Health-Abfragen ohne zusätzliche Teilnehmer sowie
  geschlossene öffentliche/private Ports nach hartem Beenden des Elternprozesses.
- Erneut sieben Python-/Bestandsdatentests, sechs Browserläufe des unveränderten
  Originals und zehn Browserläufe der Plattform; alle 30 Oliven-Bildvergleiche
  mit null abweichenden Pixeln. Keine Referenzbilder wurden angepasst.

Die CI enthält zusätzlich einen Linux-Job für Build und Python-unabhängige
Plattformtests. Dieser Job ist konfiguriert; lokal wurden die Änderungen unter
Windows geprüft. Die Run-Konfiguration wurde auf npm/Node umgestellt; ihre
Startbefehle und Prozessbeendigung wurden automatisiert geprüft, die JetBrains-
Oberfläche selbst wurde nicht ferngesteuert.

## Reichweite

Der Pixelvergleich gilt für die aufgezeichneten Zustände in Chromium unter den
angegebenen Desktop-/Mobilgrößen. Weitere Browser/physische Mobilgeräte wurden
nicht separat geprüft. Die WLAN-Adresse wurde vom lokalen Rechner erreicht;
eine gerätespezifische Firewall oder Router-Isolation lässt sich damit nicht
prüfen. Es wurden keine produktiven Daten für Browsertests verwendet.

Globale Anmeldung, Profilfragen und ein generischer Survey-Baukasten sind bewusst
noch nicht implementiert. Ihre Grenzen und der optionale Legacy-Mappingpfad sind
vorbereitet. Die ursprüngliche lokale PIN-/Konfigurationssicherheit wurde nicht
zu einem öffentlichen Authentifizierungssystem umgebaut.
