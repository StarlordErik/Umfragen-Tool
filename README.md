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
- `/oel-auswahl` verwaltet die aktive Öl-Auswahl nach Passwort-Eingabe.

Antworten, Probanden, Öle und deren Chiffre-Zuordnungen liegen lokal in `data/umfragen.sqlite3`. Probanden werden anonym per Cookie und optional per Name wiedererkannt, sodass sie weiterarbeiten können. Öle und ihre Zuordnung zu Probanden werden über die Öl-Auswahl verwaltet; dafür ist keine Code- oder JSON-Änderung nötig.

`decryption.json` enthält nur noch die verfügbaren Chiffre-Sätze. Aktive Öle und freie Platzhalter sind normale Datenbankeinträge.
