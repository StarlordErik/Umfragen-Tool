# Umfragen-Tool für das Oliven-Symposium

Start:

```powershell
python main.py
```

Der Server bindet an `0.0.0.0`, sucht ab Port `8000` einen freien Port und öffnet die Startseite auf dem Windows-PC. In der Konsole stehen die wichtigsten lokalen Seiten.

Wichtige Seiten:

- `/` zeigt die Startseite der Studie des Oliven-Symposiums.
- `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` sind die drei mobilen Umfragen.
- `/ergebnisse` zeigt in der Auswertungsphase die Ranglisten ohne zusätzliche Passwortabfrage.
- `/einzelne-oel-wertungen` zeigt in der Auswertungsphase die Aufschlüsselung je Öl mit Chiffren-Auflösung und Spoiler-Schutz.
- `/individuelle-ergebnisse` zeigt in der Auswertungsphase die Ranglisten ausschließlich aus den Wertungen des angemeldeten Probanden.
- `/kompetitive-verkostung` zeigt in der Auswertungsphase das Symposium-Minispiel.
- `/oel-auswahl` verwaltet die aktive Öl-Auswahl nach Passwort-Eingabe.

Antworten, Probanden, Öle und deren Chiffre-Zuordnungen liegen lokal in `data/umfragen.sqlite3`. Die Anmeldung mit Namen ist immer durch eine vierstellige PIN geschützt. Existiert für den Namen bereits eine PIN in `Oliven-Symposium-Momentaufnahme-PINs.txt`, wird diese beim ersten Login übernommen; andernfalls legt der Proband seine PIN selbst fest. In der Konfiguration kann die PIN eines einzelnen Probanden zurückgesetzt werden. Öle können mehreren Besitzern zugeordnet und in der Vorbereitungsphase direkt auf der Startseite eingereicht werden.

Die Datenbankdatei `data/umfragen.sqlite3` wird mit Git versioniert. Änderungen an den Umfragedaten müssen als Änderungen dieser Datei committet werden. Server-Logs und temporäre SQLite-Dateien in `data/` bleiben von Git ausgeschlossen.

`decryption.json` enthält nur noch die verfügbaren Chiffre-Sätze. Aktive Öle und freie Platzhalter sind normale Datenbankeinträge.

## Phasen

Die aktuelle Phase wird in der Konfiguration ausgewählt:

- **Vorbereitung:** Anmeldung und Öl-Einreichung sind aktiv. Die Umfragen sind sichtbar, aber gesperrt; Ergebnisse werden noch nicht angezeigt.
- **Durchführung:** Die Umfragen sind aktiv. Neue Einreichungen und Ergebnisse sind sichtbar, aber gesperrt.
- **Auswertung:** Neue Einreichungen werden ausgeblendet. Umfragen und Ergebnisse sind ohne zusätzliches Ergebnis-Passwort zugänglich.

Die eigenen Öle bleiben in allen Phasen in der Einreichungen-Kachel sichtbar. In der Auswertung erscheinen dort zusätzlich die drei Ergebnisbalken und der Gesamtmittelwert.

## Snapshot erstellen

```powershell
python create_snapshot.py
```

Das Skript erzeugt standardmäßig `Oliven-Symposium-Momentaufnahme.html`. Diese einzelne Datei enthält den aktuellen Stand aller Probanden, Antworten und Öl-Slots sowie die benötigten Styles und Skripte. Sie kann direkt im Browser geöffnet und ohne laufenden Server verwendet werden. Daneben entsteht die vertrauliche Datei `Oliven-Symposium-Momentaufnahme-PINs.txt` mit den individuellen vierstelligen PINs. Bereits vorhandene gültige PINs werden bei späteren Neuerstellungen beibehalten.

Im Snapshot gilt die Umfrage immer als beendet und ist schreibgeschützt. Auf der Startseite kann ausschließlich ein bereits vorhandener Proband ausgewählt werden; jeder Proband muss seine persönliche PIN eingeben. Namenseingabe, Veröffentlichungs-Checkboxen und der Link zur Konfiguration fehlen. Ein anderes Ziel, eine andere PIN-Liste oder eine andere Datenbank lassen sich angeben mit:

```powershell
python create_snapshot.py --output archiv/momentaufnahme-2026.html --pins-output archiv/momentaufnahme-2026-PINs.txt --db data/umfragen.sqlite3
```

Die HTML-Datei enthält sämtliche Umfrageangaben im Klartext und sollte daher wie die Datenbank vertraulich behandelt werden. Tokens, IP-Adressen und Browserkennungen werden nicht in den Snapshot übernommen.
