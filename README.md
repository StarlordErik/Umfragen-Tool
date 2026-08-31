# Umfragen-Tool für das Oliven-Symposium

Start:

```powershell
python main.py
```

Der Server bindet an `0.0.0.0`, sucht ab Port `8000` einen freien Port und öffnet die Startseite auf dem Windows-PC. In der Konsole stehen die wichtigsten lokalen Seiten.

Wichtige Seiten:

- `/` zeigt die Startseite der Studie des Oliven-Symposiums.
- `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` sind die drei mobilen Umfragen.
- `/ergebnisse` zeigt die geschützten Live-Ranglisten.
- `/einzelne-oel-wertungen` zeigt die geschützte Aufschlüsselung je Öl mit Chiffren-Auflösung und Spoiler-Schutz.
- `/individuelle-ergebnisse` zeigt die geschützten Ranglisten ausschließlich aus den Wertungen des angemeldeten Probanden.
- `/kompetitive-verkostung` zeigt das geschützte Symposium-Minispiel.
- `/oel-auswahl` verwaltet die aktive Öl-Auswahl nach Passwort-Eingabe.

Antworten, Probanden, Öle und deren Chiffre-Zuordnungen liegen lokal in `data/umfragen.sqlite3`. Probanden werden anonym per Cookie und optional per Name wiedererkannt, sodass sie weiterarbeiten können. Öle und ihre Zuordnung zu Probanden werden über die Öl-Auswahl verwaltet; dafür ist keine Code- oder JSON-Änderung nötig.

`decryption.json` enthält nur noch die verfügbaren Chiffre-Sätze. Aktive Öle und freie Platzhalter sind normale Datenbankeinträge.

## Snapshot erstellen

```powershell
python create_snapshot.py
```

Das Skript erzeugt standardmäßig `Oliven-Symposium-Momentaufnahme.html`. Diese einzelne Datei enthält den aktuellen Stand aller Probanden, Antworten und Öl-Slots sowie die benötigten Styles und Skripte. Sie kann direkt im Browser geöffnet und ohne laufenden Server verwendet werden. Daneben entsteht die vertrauliche Datei `Oliven-Symposium-Momentaufnahme-PINs.txt` mit den individuellen vierstelligen PINs. Bereits vorhandene gültige PINs werden bei späteren Neuerstellungen beibehalten.

Im Snapshot gilt die Umfrage immer als beendet und ist schreibgeschützt. Auf der Startseite kann ausschließlich ein bereits vorhandener Proband ausgewählt werden; alle Probanden außer Erik müssen ihre persönliche PIN eingeben. Namenseingabe, Veröffentlichungs-Checkboxen und der Link zur Konfiguration fehlen. Ein anderes Ziel, eine andere PIN-Liste oder eine andere Datenbank lassen sich angeben mit:

```powershell
python create_snapshot.py --output archiv/momentaufnahme-2026.html --pins-output archiv/momentaufnahme-2026-PINs.txt --db data/umfragen.sqlite3
```

Die HTML-Datei enthält sämtliche Umfrageangaben im Klartext und sollte daher wie die Datenbank vertraulich behandelt werden. Tokens, IP-Adressen und Browserkennungen werden nicht in den Snapshot übernommen.
